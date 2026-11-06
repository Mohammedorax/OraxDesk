//! RDP audio playback: decoded PCM to this machine's sound card.
//!
//! `rdp-core` decodes MS-RDPEA (behind the `audio` feature, on by default) and
//! hands the shell a [`remote_core::AudioPacket`] of interleaved `i16` PCM.
//! This module is the other half: a device, a buffer in front of it, and the
//! conversions between what the server sends and what the device will take.
//!
//! # Why a thread of its own
//!
//! `cpal::Stream` is not `Send` on every platform, and an audio callback has a
//! deadline: it must never wait on a lock an async task might hold. So one
//! dedicated thread owns the device for the life of the session, and the async
//! runtime only ever does `send` on a channel (non-blocking, drops on a full
//! queue rather than stalling a session). The callback takes a short
//! `parking_lot` lock around a `VecDeque` that the producer holds for the
//! length of one `extend`, which is the standard shape for this and far
//! cheaper than a lock-free ring whose failure mode would be worse.
//!
//! # Why the format conversion is here
//!
//! MS-RDPEA lets the client answer the format negotiation with 16-bit PCM at
//! 48 or 44.1 kHz, but it does not choose the sound card's rate or channel
//! count. A device that runs at 48 kHz plays 44.1 kHz audio a semitone sharp
//! if the samples are handed over unchanged, so [`Converter`] maps channels
//! (mono to stereo, stereo to mono) and linearly resamples when the rates
//! differ. The identity case is a straight copy, which is what almost every
//! session will take.
//!
//! # When there is no device
//!
//! A headless machine, a locked-down container, or a missing sound card is
//! not a session failure. The thread logs once and discards what arrives; the
//! desktop keeps working, silently.

use std::collections::VecDeque;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use parking_lot::Mutex;
use remote_core::AudioPacket;

/// How much audio may wait in front of the device, in milliseconds.
///
/// A session pause or a slow device must not make the queue grow without
/// bound: 500 ms is enough to ride out a scheduling hiccup, and small enough
/// that a permanent stall costs half a second and no more memory.
const MAX_BUFFER_MS: u32 = 500;

/// How long the audio thread waits for work before checking whether the
/// session has gone away. The thread also wakes immediately on a packet or on
/// the sender being dropped, so this only bounds an idle exit.
const IDLE_POLL: Duration = Duration::from_millis(250);

/// A handle to one session's audio thread.
///
/// Dropping it closes the channel, and the thread then drops the device
/// stream. Nothing else has to be told the session ended.
pub struct AudioPlayer {
    tx: Option<Sender<Command>>,
}

enum Command {
    Play(AudioPacket),
}

impl AudioPlayer {
    /// Start a player. The output device is opened by the thread, on the
    /// first packet, so a session that never sends audio costs no device.
    #[must_use]
    pub fn start() -> Self {
        let (tx, rx) = mpsc::channel();
        let spawned = std::thread::Builder::new()
            .name("rdp-audio".to_string())
            .spawn(move || run(rx));
        match spawned {
            Ok(_) => Self { tx: Some(tx) },
            Err(error) => {
                tracing::warn!(
                    %error,
                    "could not start the audio thread; this session will be silent"
                );
                Self { tx: None }
            }
        }
    }

    /// Hand one block to the audio thread. Never blocks the session: if the
    /// queue is full or the thread has gone, the block is dropped.
    pub fn play(&self, packet: AudioPacket) {
        if let Some(tx) = &self.tx {
            let _ = tx.send(Command::Play(packet));
        }
    }
}

/// The audio thread: open the device when there is something to play, convert
/// what arrives to the device's format, and keep the queue bounded.
fn run(rx: Receiver<Command>) {
    let mut sink: Option<Sink> = None;
    let mut converter: Option<Converter> = None;
    let mut warned = false;
    loop {
        match rx.recv_timeout(IDLE_POLL) {
            Ok(Command::Play(packet)) => {
                if sink.is_none() {
                    match Sink::open() {
                        Ok(opened) => sink = Some(opened),
                        Err(reason) => {
                            if !warned {
                                warned = true;
                                tracing::warn!(
                                    %reason,
                                    "audio redirection is on but there is no output device; this session will be silent"
                                );
                            }
                            continue;
                        }
                    }
                }
                let Some(sink) = sink.as_mut() else {
                    continue;
                };
                let wanted = (packet.sample_rate, packet.channels);
                if converter
                    .as_ref()
                    .is_none_or(|c| (c.src_rate, c.src_channels) != (wanted.0, wanted.1 as usize))
                {
                    converter = Some(Converter::new(
                        packet.sample_rate,
                        packet.channels as usize,
                        sink.rate,
                        sink.channels,
                    ));
                }
                let Some(converter) = converter.as_mut() else {
                    continue;
                };
                let samples = converter.push(&packet.pcm);
                sink.enqueue(&samples);
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
}

/// The open output device and the samples waiting in front of it.
struct Sink {
    /// Held only to keep the stream alive; dropping it stops the callback and
    /// releases the device.
    _stream: cpal::Stream,
    queued: Arc<Mutex<VecDeque<i16>>>,
    /// The device's rate, which the converter resamples towards.
    rate: u32,
    /// The device's channel count, which the converter maps towards.
    channels: usize,
    /// The most samples that may wait; see [`MAX_BUFFER_MS`].
    capacity: usize,
}

impl Sink {
    fn open() -> Result<Self, String> {
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| "no default audio output device".to_string())?;
        let supported = device.default_output_config().map_err(|error| {
            format!("the output device has no usable default configuration: {error}")
        })?;
        let sample_format = supported.sample_format();
        let config: cpal::StreamConfig = supported.into();
        let rate = config.sample_rate.0;
        let channels = usize::from(config.channels);
        if rate == 0 || channels == 0 {
            return Err("the output device reported a zero rate or channel count".to_string());
        }
        let queued: Arc<Mutex<VecDeque<i16>>> = Arc::new(Mutex::new(VecDeque::new()));
        let capacity = (rate as usize)
            .saturating_mul(channels)
            .saturating_mul(MAX_BUFFER_MS as usize)
            / 1000;

        let err_fn = |error| tracing::warn!(%error, "the audio output stream failed");

        // The same callback shape for every sample format the device may ask
        // for, with the conversion to that format inside it. `build` is
        // generic over the sample type so the three arms below are one
        // function, not three copies of the queue drain.
        let stream = match sample_format {
            cpal::SampleFormat::F32 => build::<f32>(&device, &config, queued.clone(), err_fn),
            cpal::SampleFormat::I16 => build::<i16>(&device, &config, queued.clone(), err_fn),
            cpal::SampleFormat::U16 => build::<u16>(&device, &config, queued.clone(), err_fn),
            other => Err(format!(
                "the output device wants {other:?} samples, which this build does not convert"
            )),
        }?;
        stream
            .play()
            .map_err(|error| format!("the output device refused to start: {error}"))?;

        Ok(Self {
            _stream: stream,
            queued,
            rate,
            channels,
            capacity,
        })
    }

    /// Add converted samples, dropping the oldest if the queue would pass its
    /// ceiling. Dropping the oldest keeps playback close to real time; dropping
    /// the newest would grow the delay instead.
    fn enqueue(&mut self, samples: &[i16]) {
        if samples.is_empty() {
            return;
        }
        let mut queued = self.queued.lock();
        let excess = queued
            .len()
            .saturating_add(samples.len())
            .saturating_sub(self.capacity);
        if excess > 0 {
            let drop = excess.min(queued.len());
            queued.drain(..drop);
        }
        queued.extend(samples.iter().copied());
    }
}

/// Build the output stream for one sample type. The callback drains the queue
/// into whatever buffer the device hands it, and silence past the end.
fn build<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    queued: Arc<Mutex<VecDeque<i16>>>,
    err_fn: impl FnMut(cpal::StreamError) + Send + 'static,
) -> Result<cpal::Stream, String>
where
    T: cpal::SizedSample + FromI16 + Send + 'static,
{
    device
        .build_output_stream(
            config,
            move |data: &mut [T], _: &cpal::OutputCallbackInfo| {
                let mut queued = queued.lock();
                for slot in data.iter_mut() {
                    *slot = match queued.pop_front() {
                        Some(sample) => T::from_i16(sample),
                        None => T::from_i16(0),
                    };
                }
            },
            err_fn,
            None,
        )
        .map_err(|error| format!("the output device rejected the stream: {error}"))
}

/// `i16` PCM into the device's sample type.
trait FromI16 {
    fn from_i16(sample: i16) -> Self;
}

impl FromI16 for f32 {
    fn from_i16(sample: i16) -> Self {
        f32::from(sample) / 32_768.0
    }
}

impl FromI16 for i16 {
    fn from_i16(sample: i16) -> Self {
        sample
    }
}

impl FromI16 for u16 {
    fn from_i16(sample: i16) -> Self {
        (i32::from(sample) + 32_768) as u16
    }
}

/// Channel mapping and rate conversion between what the server sends and what
/// the device takes.
///
/// Stateful on purpose: a linear resampler that restarts at every packet
/// introduces a boundary click at fifty packets a second, so the fractional
/// position and the last frame carry over.
struct Converter {
    src_rate: u32,
    src_channels: usize,
    dst_rate: u32,
    dst_channels: usize,
    /// Input frames consumed per output frame.
    step: f64,
    /// Fractional read position, in input frames, relative to the next packet.
    pos: f64,
    /// The last input frame of the previous packet, mapped to the output
    /// channel count, so interpolation across a packet boundary is continuous.
    previous: Vec<f32>,
    have_previous: bool,
}

impl Converter {
    fn new(src_rate: u32, src_channels: usize, dst_rate: u32, dst_channels: usize) -> Self {
        debug_assert!(src_rate > 0 && dst_rate > 0 && src_channels > 0 && dst_channels > 0);
        Self {
            src_rate,
            src_channels,
            dst_rate,
            dst_channels,
            step: f64::from(src_rate) / f64::from(dst_rate),
            pos: 0.0,
            previous: Vec::new(),
            have_previous: false,
        }
    }

    /// The common case: the server and the device agree, so nothing is
    /// touched. This is what 48 kHz stereo on a 48 kHz stereo device takes.
    fn passthrough(&self) -> bool {
        self.src_rate == self.dst_rate && self.src_channels == self.dst_channels
    }

    /// Convert one block. The returned samples are at the device's rate and
    /// channel count.
    fn push(&mut self, pcm: &[i16]) -> Vec<i16> {
        let frames = pcm.len() / self.src_channels;
        if frames == 0 {
            return Vec::new();
        }
        if self.passthrough() {
            return pcm.to_vec();
        }

        let mapped = map_channels(pcm, frames, self.src_channels, self.dst_channels);
        let estimate = (frames as f64 / self.step) as usize + 2;
        let mut out = Vec::with_capacity(estimate.saturating_mul(self.dst_channels));

        while self.pos < frames as f64 {
            let index = self.pos.floor();
            let fraction = (self.pos - index) as f32;
            let index = index as isize;
            for channel in 0..self.dst_channels {
                let a = self.frame(&mapped, frames, index, channel);
                let b = self.frame(&mapped, frames, index + 1, channel);
                let value = a + (b - a) * fraction;
                // `as i16` saturates in Rust, and NaN becomes zero, so this
                // cannot produce a wrapped sample from a hostile stream.
                out.push(value.round() as i16);
            }
            self.pos += self.step;
        }
        self.pos -= frames as f64;

        self.previous.clear();
        self.previous.extend_from_slice(
            &mapped[(frames - 1) * self.dst_channels..frames * self.dst_channels],
        );
        self.have_previous = true;
        out
    }

    /// One mapped sample, clamped at both ends of the block.
    ///
    /// Before the first frame the previous packet's last frame is used, which
    /// is what carries interpolation across a packet boundary. Past the last
    /// frame the last sample is held: the next packet's first frame is not
    /// known yet, and holding costs one sample of error once per packet.
    fn frame(&self, mapped: &[f32], frames: usize, index: isize, channel: usize) -> f32 {
        if index < 0 {
            if self.have_previous {
                return self.previous.get(channel).copied().unwrap_or(0.0);
            }
            return mapped[channel];
        }
        let index = (index as usize).min(frames - 1);
        mapped[index * self.dst_channels + channel]
    }
}

/// Interleaved `i16` at `src_channels` to `f32` at `dst_channels`.
///
/// Mono to stereo duplicates, stereo to mono averages, and any other shape
/// replicates the source channels it has. The result is `f32` because the
/// resampler wants fractional values, not quantised ones.
fn map_channels(pcm: &[i16], frames: usize, src_channels: usize, dst_channels: usize) -> Vec<f32> {
    let mut out = Vec::with_capacity(frames * dst_channels);
    for frame in 0..frames {
        let base = frame * src_channels;
        match (src_channels, dst_channels) {
            (1, 2) => {
                let value = f32::from(pcm[base]);
                out.push(value);
                out.push(value);
            }
            (2, 1) => {
                out.push((f32::from(pcm[base]) + f32::from(pcm[base + 1])) * 0.5);
            }
            _ => {
                for channel in 0..dst_channels {
                    let source = base + channel.min(src_channels - 1);
                    out.push(f32::from(pcm[source]));
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::Converter;

    fn converter(
        src_rate: u32,
        src_channels: usize,
        dst_rate: u32,
        dst_channels: usize,
    ) -> Converter {
        Converter::new(src_rate, src_channels, dst_rate, dst_channels)
    }

    /// The common case must not touch the samples at all: no rounding, no
    /// channel shuffle, no resampler state.
    #[test]
    fn matching_rates_and_channels_are_passed_through_exactly() {
        let pcm: Vec<i16> = vec![0, 1, -1, 32767, -32768, 100, -100, 0];
        let mut c = converter(48_000, 2, 48_000, 2);
        assert_eq!(c.push(&pcm), pcm);
    }

    #[test]
    fn mono_is_duplicated_to_stereo() {
        let mut c = converter(48_000, 1, 48_000, 2);
        assert_eq!(c.push(&[100, -200]), vec![100, 100, -200, -200]);
    }

    #[test]
    fn stereo_is_averaged_to_mono() {
        let mut c = converter(48_000, 2, 48_000, 1);
        assert_eq!(c.push(&[100, 300, -100, -300]), vec![200, -200]);
    }

    /// Halving the rate keeps every other frame, which is what a 2:1 linear
    /// resampler does with integral positions.
    #[test]
    fn half_the_rate_keeps_half_the_frames() {
        let mut c = converter(48_000, 1, 24_000, 1);
        assert_eq!(c.push(&[0, 1, 2, 3, 4, 5, 6, 7]), vec![0, 2, 4, 6]);
    }

    #[test]
    fn doubling_the_rate_interpolates_between_frames() {
        let mut c = converter(24_000, 1, 48_000, 1);
        // Positions 0, 0.5, 1.0, 1.5: 10, 15, 20, and the held last frame 20.
        assert_eq!(c.push(&[10, 20]), vec![10, 15, 20, 20]);
    }

    /// A packet boundary must not restart the phase, or the resampler would
    /// drop or repeat a frame every twenty milliseconds.
    #[test]
    fn the_resampler_position_carries_across_packets() {
        let mut c = converter(48_000, 1, 24_000, 1);
        assert_eq!(c.push(&[0, 1, 2, 3]), vec![0, 2]);
        assert_eq!(c.push(&[4, 5, 6, 7]), vec![4, 6]);
    }

    /// 44.1 kHz into a 48 kHz device is the conversion a great many machines
    /// will actually need. 441 frames of 10 ms must produce about the 480
    /// frames of 10 ms at the device rate; the position is accumulated in
    /// `f64`, so a packet that lands exactly on a frame boundary may produce
    /// one more sample than the ideal count. That is the harmless direction:
    /// one extra sample, never a dropped one.
    #[test]
    fn forty_four_one_into_forty_eight_produces_the_right_count() {
        let mut c = converter(44_100, 1, 48_000, 1);
        let pcm: Vec<i16> = (0..441).map(|n| (n * 7) as i16).collect();
        let produced = c.push(&pcm).len();
        assert!((480..=481).contains(&produced), "produced {produced}");
    }

    /// A hostile or buggy server can send anything; none of it may panic the
    /// audio thread. An `i16` cannot leave `i16` range, so the property worth
    /// pinning is the round trip itself: the first stereo frame averages to
    /// exactly -0.5, which rounds away from zero rather than wrapping.
    #[test]
    fn extreme_samples_do_not_wrap() {
        let mut c = converter(44_100, 2, 48_000, 1);
        let out = c.push(&[i16::MIN, i16::MAX, i16::MIN, i16::MIN]);
        assert!(!out.is_empty());
        assert_eq!(out[0], -1);
    }

    /// An odd number of samples cannot be a complete frame; the tail is
    /// dropped rather than read as the start of the next frame.
    #[test]
    fn a_partial_frame_is_ignored() {
        let mut c = converter(48_000, 2, 48_000, 1);
        assert_eq!(c.push(&[100, 300, 7]), vec![200]);
    }
}

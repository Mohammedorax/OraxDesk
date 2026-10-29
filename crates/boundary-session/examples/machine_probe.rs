//! Temporary diagnostic: connect to an unattended machine by ID, the way the
//! app's Boundary driver does, and print every event with timestamps.
//!
//! Not part of the product; used to see exactly where a connection stops.
//! usage: machine_probe <key-file> <machine-id> [password] [seconds]

use boundary_session::unattended;
use boundary_session::{Event, HostOptions};
use std::time::{Duration, Instant};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() < 2 {
        anyhow::bail!("usage: machine_probe <key-file> <machine-id> [password] [seconds]");
    }
    let key_path = std::path::PathBuf::from(&args[0]);
    let machine = args[1].clone();
    let password = args.get(2).filter(|p| !p.is_empty()).cloned();
    let seconds: u64 = args
        .get(3)
        .and_then(|s| s.parse().ok())
        .unwrap_or(75);

    let started = Instant::now();
    let key = unattended::load_or_create_key(&key_path)?;
    println!("{:.1}s helper id: {}", started.elapsed().as_secs_f32(), unattended::machine_id(&key));
    println!("{:.1}s target: {machine}", started.elapsed().as_secs_f32());

    let mut session = unattended::connect_with_tools(
        machine.clone(),
        "OraxDesk (diagnostic)".into(),
        password,
        key,
        HostOptions::default().with_directory_from_env(None),
    );

    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    loop {
        tokio::select! {
            _ = tokio::time::sleep_until(deadline) => {
                println!("{:.1}s DEADLINE reached with no terminal event", started.elapsed().as_secs_f32());
                session.stop();
                break;
            }
            event = session.events.recv() => match event {
                Some(Event::Status(s)) => println!("{:.1}s status: {s}", started.elapsed().as_secs_f32()),
                Some(Event::Connected { peer, control }) => {
                    println!("{:.1}s CONNECTED peer={peer} control={control}", started.elapsed().as_secs_f32());
                    let route = session.connectivity.borrow().route;
                    println!("{:.1}s route: {route:?}", started.elapsed().as_secs_f32());
                }
                Some(Event::Finished(result)) => {
                    println!("{:.1}s FINISHED: {result:?}", started.elapsed().as_secs_f32());
                    break;
                }
                Some(Event::Paired { machine, name }) => {
                    println!("{:.1}s paired: {machine} as {name}", started.elapsed().as_secs_f32());
                }
                Some(Event::Tools(allowed)) => {
                    println!("{:.1}s tools allowed: {allowed}", started.elapsed().as_secs_f32())
                }
                Some(_) => println!("{:.1}s other event", started.elapsed().as_secs_f32()),
                None => {
                    println!("{:.1}s events channel closed", started.elapsed().as_secs_f32());
                    break;
                }
            },
            changed = session.frames.changed() => {
                if changed.is_err() {
                    continue;
                }
                if let Some(frame) = session.frames.borrow_and_update().clone() {
                    println!(
                        "{:.1}s FRAME {}x{} ({} bytes) — access proven",
                        started.elapsed().as_secs_f32(),
                        frame.width,
                        frame.height,
                        frame.rgba.len()
                    );
                    break;
                }
            }
        }
    }
    session.stop();
    Ok(())
}

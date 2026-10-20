//! The device directory, as iroh's address lookup.
//!
//! iroh already knows how to find a machine by its id alone: the address
//! directory. Today that directory is n0's, and a machine publishes its
//! address there whether or not it wants to.
//!
//! This is the same thing pointed at a registry the deployment controls. It
//! changes WHERE the address is published and nothing else: the transport is
//! still iroh's QUIC with its own hole punching, the authorisation is still
//! the machine's own access file, and no media passes through here.
//!
//! Two things follow, and both are the point:
//!
//!   * A deployment does not depend on somebody else's directory to find its
//!     own machines, and a machine that has left that directory can still be
//!     reached.
//!   * A directory outage cannot interrupt a session. The directory is
//!     consulted when a connection is BEING MADE, never while one is running,
//!     and a running session is a QUIC connection that does not pass through
//!     it at all.
//!
//! It is additive on purpose. A deployment with no registry configured
//! publishes and resolves exactly as it did before, through n0.

use iroh::{
    address_lookup::{AddressLookup, EndpointData, EndpointInfo, Error, Item},
    EndpointAddr, EndpointId,
};
use n0_future::boxed::BoxStream;

use crate::{Client, DeviceKeys, Error as RegistryError};

/// Where an address came from, in the provenance string iroh records.
const PROVENANCE: &str = "deskvnc-registry";

/// The directory, as iroh's address lookup.
///
/// The client is shared: it owns the connection pool, and a directory that
/// opened a new connection per lookup would cost more than the lookup it
/// exists to make cheap.
pub struct Directory {
    client: Client,
    keys: Option<DeviceKeys>,
}

impl std::fmt::Debug for Directory {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Directory")
            .field("publishes", &self.keys.is_some())
            .finish()
    }
}

impl Directory {
    /// A directory that only reads, for a helper that finds a machine.
    pub fn reader(client: Client) -> Self {
        Self { client, keys: None }
    }

    /// A directory that publishes as well, for a machine that wants to be
    /// found.
    pub fn publisher(client: Client, keys: DeviceKeys) -> Self {
        Self {
            client,
            keys: Some(keys),
        }
    }

    /// The address of a device, as the registry has it.
    pub async fn address(&self, id: EndpointId) -> Result<Option<EndpointAddr>, RegistryError> {
        self.client.lookup_address(&id.to_string()).await
    }
}

impl AddressLookup for Directory {
    /// Publish this endpoint's address, so a helper can find it by id.
    ///
    /// iroh calls this whenever the address changes, and it cannot wait for
    /// the answer, so the work happens in its own task. A failure is logged
    /// and dropped: a machine that cannot publish is a machine that cannot be
    /// found by id, which is a degraded path and not a broken session.
    fn publish(&self, data: &EndpointData) {
        let Some(keys) = self.keys.clone() else {
            return;
        };
        let client = self.client.clone();
        let id = EndpointId::from(keys.identity.public());
        let addrs: std::collections::BTreeSet<_> = data.addrs().cloned().collect();
        tokio::spawn(async move {
            let address = EndpointAddr { id, addrs };
            if let Err(error) = client.publish_address(&keys, &address).await {
                tracing::warn!("could not publish the address to the registry: {error}");
            }
        });
    }

    /// Resolve a device id to the address it published.
    ///
    /// One item, or none. A device that has not published, or whose address
    /// has gone stale, resolves to nothing, and the caller falls back to
    /// whatever else it knows.
    fn resolve(&self, endpoint_id: EndpointId) -> Option<BoxStream<Result<Item, Error>>> {
        let client = self.client.clone();
        let stream = n0_future::stream::once_future(async move {
            match client.lookup_address(&endpoint_id.to_string()).await {
                Ok(Some(address)) => {
                    let info: EndpointInfo = address.into();
                    Ok(Item::new(info, PROVENANCE, None))
                }
                // A device that is not in the directory is not an error: it is
                // the ordinary answer for a machine that has not published,
                // and the caller falls back to another source.
                Ok(None) => Err(Error::from_err(
                    PROVENANCE,
                    std::io::Error::other("the device has not published an address"),
                )),
                Err(error) => Err(Error::from_err(
                    PROVENANCE,
                    std::io::Error::other(error.to_string()),
                )),
            }
        });
        Some(Box::pin(stream))
    }
}

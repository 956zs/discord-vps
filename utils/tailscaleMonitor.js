const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * Get Tailscale status including all connected nodes
 * @returns {Object} Tailscale status information
 */
async function getStatus() {
  try {
    // Run tailscale status command with JSON output
    const output = execSync("tailscale status --json").toString();
    const statusData = JSON.parse(output);

    // Format the data for easier consumption
    const formattedStatus = {
      self: {}, // Will store information about this device
      peers: [],
      success: true,
    };

    // Process each peer in the status
    for (const [id, peer] of Object.entries(statusData.Peer)) {
      const peerInfo = {
        id,
        hostname: peer.HostName,
        ip: peer.TailscaleIPs.join(", "),
        os: peer.OS,
        exitNode: !!peer.ExitNode,
        online: !!peer.Online,
        lastSeen: peer.LastSeen ? new Date(peer.LastSeen).toISOString() : null,
        rxBytes: peer.RxBytes,
        txBytes: peer.TxBytes,
      };

      // If this is the current machine, store it separately
      if (id === statusData.Self.ID) {
        formattedStatus.self = {
          ...peerInfo,
          exitNodeIP: statusData.Self.ExitNodeIP || null,
          usingExitNode: !!statusData.Self.ExitNodeIP,
        };
      } else {
        formattedStatus.peers.push(peerInfo);
      }
    }

    return formattedStatus;
  } catch (error) {
    console.error("Error getting Tailscale status:", error);
    return {
      success: false,
      error: error.message,
      command: "tailscale status",
    };
  }
}

/**
 * Enable a specific device as Exit Node
 * @param {string} hostname The hostname of the device to use as exit node
 * @returns {Object} Result of the operation
 */
async function enableExitNode(hostname) {
  try {
    // First check if the hostname exists
    const status = await getStatus();
    if (!status.success) {
      return {
        success: false,
        error: "Failed to check Tailscale status",
        details: status.error,
      };
    }

    // Find the peer with the specified hostname
    const peer = status.peers.find((p) => p.hostname === hostname);
    if (!peer) {
      return {
        success: false,
        error: `No peer found with hostname: ${hostname}`,
        availableHosts: status.peers.map((p) => p.hostname),
      };
    }

    // Check if the peer can be used as an exit node
    if (!peer.exitNode) {
      return {
        success: false,
        error: `Peer '${hostname}' is not configured as an exit node`,
        suggestion:
          "This peer must have exit node capability enabled in Tailscale admin",
      };
    }

    // Set up the exit node
    const output = execSync(
      `tailscale up --exit-node=${peer.ip.split(",")[0].trim()}`
    ).toString();

    return {
      success: true,
      message: `Successfully set ${hostname} as exit node`,
      ip: peer.ip.split(",")[0].trim(),
      output: output,
    };
  } catch (error) {
    console.error("Error enabling exit node:", error);
    return {
      success: false,
      error: error.message,
      command: "tailscale up --exit-node",
    };
  }
}

/**
 * Disable the current Exit Node and return to normal routing
 * @returns {Object} Result of the operation
 */
async function disableExitNode() {
  try {
    const output = execSync('tailscale up --exit-node=""').toString();

    return {
      success: true,
      message: "Successfully disabled exit node",
      output: output,
    };
  } catch (error) {
    console.error("Error disabling exit node:", error);
    return {
      success: false,
      error: error.message,
      command: 'tailscale up --exit-node=""',
    };
  }
}

/**
 * Get Tailscale network traffic statistics
 * @returns {Object} Network traffic data
 */
async function getNetStats() {
  try {
    // Try to get ping statistics to a public IP
    const pingStats = execSync("ping -c 4 8.8.8.8").toString();

    // Get interface statistics
    const ifconfigOutput = execSync(
      "ifconfig tailscale0 || ip -s link show tailscale0"
    ).toString();

    // Attempt to get basic traffic information from tailscale status
    const status = await getStatus();

    return {
      success: true,
      ping: pingStats,
      interface: ifconfigOutput,
      status: status.success ? status : null,
    };
  } catch (error) {
    console.error("Error getting Tailscale network stats:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Start the Tailscale service
 * @returns {Object} Result of the operation
 */
async function startTailscale() {
  try {
    const output = execSync(
      "sudo systemctl start tailscaled && tailscale up"
    ).toString();

    return {
      success: true,
      message: "Successfully started Tailscale service",
      output: output,
    };
  } catch (error) {
    console.error("Error starting Tailscale:", error);
    return {
      success: false,
      error: error.message,
      command: "systemctl start tailscaled && tailscale up",
    };
  }
}

/**
 * Stop the Tailscale service
 * @returns {Object} Result of the operation
 */
async function stopTailscale() {
  try {
    const output = execSync(
      "tailscale down && sudo systemctl stop tailscaled"
    ).toString();

    return {
      success: true,
      message: "Successfully stopped Tailscale service",
      output: output,
    };
  } catch (error) {
    console.error("Error stopping Tailscale:", error);
    return {
      success: false,
      error: error.message,
      command: "tailscale down && systemctl stop tailscaled",
    };
  }
}

module.exports = {
  getStatus,
  enableExitNode,
  disableExitNode,
  getNetStats,
  startTailscale,
  stopTailscale,
};

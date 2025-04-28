const { exec } = require("child_process");
const util = require("util");
const fs = require("fs");
const path = require("path");
const execPromise = util.promisify(exec);

/**
 * Get a list of active WireGuard interfaces on the system
 * @returns {Promise<Array>} List of WireGuard interfaces with details
 */
async function listInterfaces() {
  try {
    // First check if wireguard is available
    try {
      await execPromise("which wg");
    } catch (error) {
      return {
        success: false,
        error: "WireGuard tools are not installed on this system.",
      };
    }

    // Get list of WireGuard interfaces from wg show
    const { stdout: wgOutput } = await execPromise("wg show interfaces");
    const interfaces = wgOutput.trim().split(/\s+/);

    // If no interfaces found
    if (!interfaces[0]) {
      return {
        success: true,
        interfaces: [],
      };
    }

    // Collect details for each interface
    const interfaceDetails = await Promise.all(
      interfaces.map(async (iface) => {
        try {
          // Get interface details
          const { stdout: wgShowOutput } = await execPromise(
            `wg show ${iface} dump`
          );
          const lines = wgShowOutput.trim().split("\n");

          // Get interface line (first line)
          const interfaceLine = lines[0].split("\t");

          // Count peers (remaining lines)
          const peerCount = lines.length > 1 ? lines.length - 1 : 0;

          // Get interface IP with ip command
          const { stdout: ipOutput } = await execPromise(
            `ip -o -4 addr show ${iface}`
          );
          const ipMatch = ipOutput.match(/inet\s+([0-9.]+\/[0-9]+)/);
          const ip = ipMatch ? ipMatch[1] : "N/A";

          // Check if the interface is up
          const { stdout: ifaceStatus } = await execPromise(
            `ip link show ${iface}`
          );
          const isUp = ifaceStatus.includes("state UP");

          // Try to get conf file path
          let confPath = null;
          if (fs.existsSync(`/etc/wireguard/${iface}.conf`)) {
            confPath = `/etc/wireguard/${iface}.conf`;
          }

          return {
            name: iface,
            publicKey: interfaceLine[1] || "N/A",
            listenPort: interfaceLine[2] || "N/A",
            ip,
            isUp,
            peerCount,
            confPath,
          };
        } catch (error) {
          console.error(`Error getting details for interface ${iface}:`, error);
          return {
            name: iface,
            error: `Failed to get details: ${error.message}`,
          };
        }
      })
    );

    return {
      success: true,
      interfaces: interfaceDetails,
    };
  } catch (error) {
    console.error("Error listing WireGuard interfaces:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get details about peers for a specific WireGuard interface
 * @param {string} interfaceName - Name of the WireGuard interface (e.g., wg0)
 * @returns {Promise<Object>} Peer details for the specified interface
 */
async function getPeers(interfaceName) {
  try {
    // Validate interface name for security
    if (!/^[a-zA-Z0-9_]+$/.test(interfaceName)) {
      return {
        success: false,
        error: "Invalid interface name",
      };
    }

    // Check if the interface exists
    const { stdout: wgOutput } = await execPromise("wg show interfaces");
    const interfaces = wgOutput.trim().split(/\s+/);

    if (!interfaces.includes(interfaceName)) {
      return {
        success: false,
        error: `Interface ${interfaceName} not found`,
      };
    }

    // Get peer details
    const { stdout: wgShowOutput } = await execPromise(
      `wg show ${interfaceName} dump`
    );
    const lines = wgShowOutput.trim().split("\n");

    // Skip first line (interface info)
    const peerLines = lines.slice(1);

    // Parse peer information
    const peers = peerLines.map((line) => {
      const fields = line.split("\t");
      return {
        publicKey: fields[0] || "N/A",
        presharedKey: fields[1] || "N/A",
        endpoint: fields[2] || "N/A",
        allowedIPs: fields[3] || "N/A",
        latestHandshake: fields[4]
          ? formatHandshakeTime(parseInt(fields[4]))
          : "Never",
        transferRx: fields[5] ? formatBytes(parseInt(fields[5])) : "0 B",
        transferTx: fields[6] ? formatBytes(parseInt(fields[6])) : "0 B",
        keepalive: fields[7] || "N/A",
      };
    });

    // Try to get peer names from config file
    try {
      const configPath = `/etc/wireguard/${interfaceName}.conf`;
      if (fs.existsSync(configPath)) {
        const configContent = fs.readFileSync(configPath, "utf8");
        const sections = configContent.split(/\[(Peer|Interface)\]/i);

        // Process each peer section to extract peer names from comments
        for (let i = 1; i < sections.length; i += 2) {
          if (sections[i].toLowerCase() === "peer" && i + 1 < sections.length) {
            const peerSection = sections[i + 1];
            const publicKeyMatch = peerSection.match(
              /PublicKey\s*=\s*([a-zA-Z0-9+\/=]+)/i
            );

            if (publicKeyMatch) {
              const publicKey = publicKeyMatch[1].trim();
              // Look for peer name in comments above the peer section
              const commentMatch = peerSection.match(
                /^#\s*(Name|Client|User):\s*(.+)$/im
              );

              if (commentMatch) {
                const peerName = commentMatch[2].trim();
                // Find matching peer by public key and add name
                const peer = peers.find((p) => p.publicKey === publicKey);
                if (peer) {
                  peer.name = peerName;
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error parsing config file for ${interfaceName}:`, error);
    }

    return {
      success: true,
      interface: interfaceName,
      peers: peers,
    };
  } catch (error) {
    console.error(`Error getting peers for interface ${interfaceName}:`, error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Restart a WireGuard interface
 * @param {string} interfaceName - Name of the WireGuard interface to restart
 * @returns {Promise<Object>} Result of the restart operation
 */
async function restartInterface(interfaceName) {
  try {
    // Validate interface name for security
    if (!/^[a-zA-Z0-9_]+$/.test(interfaceName)) {
      return {
        success: false,
        error: "Invalid interface name",
      };
    }

    // Check if the interface exists
    const { stdout: wgOutput } = await execPromise("wg show interfaces");
    const interfaces = wgOutput.trim().split(/\s+/);

    if (!interfaces.includes(interfaceName)) {
      return {
        success: false,
        error: `Interface ${interfaceName} not found`,
      };
    }

    // Check if wg-quick is available
    try {
      await execPromise("which wg-quick");
    } catch (error) {
      return {
        success: false,
        error: "wg-quick tool is not available on this system",
      };
    }

    // Restart the interface with wg-quick
    const downResult = await execPromise(`wg-quick down ${interfaceName}`);
    const upResult = await execPromise(`wg-quick up ${interfaceName}`);

    return {
      success: true,
      interface: interfaceName,
      message: `Interface ${interfaceName} successfully restarted`,
      details: {
        down: downResult.stdout,
        up: upResult.stdout,
      },
    };
  } catch (error) {
    console.error(`Error restarting interface ${interfaceName}:`, error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Add a new peer to a WireGuard interface
 * @param {string} interfaceName - Name of the WireGuard interface
 * @param {Object} peerData - Peer data including name, publicKey, allowedIPs
 * @returns {Promise<Object>} Result of the add operation
 */
async function addPeer(interfaceName, peerData) {
  try {
    // Validate interface name for security
    if (!/^[a-zA-Z0-9_]+$/.test(interfaceName)) {
      return {
        success: false,
        error: "Invalid interface name",
      };
    }

    // Validate required peer data
    if (!peerData.publicKey || !peerData.allowedIPs) {
      return {
        success: false,
        error: "Public key and allowed IPs are required",
      };
    }

    // Check if the interface exists
    const { stdout: wgOutput } = await execPromise("wg show interfaces");
    const interfaces = wgOutput.trim().split(/\s+/);

    if (!interfaces.includes(interfaceName)) {
      return {
        success: false,
        error: `Interface ${interfaceName} not found`,
      };
    }

    // Get config file path
    const configPath = `/etc/wireguard/${interfaceName}.conf`;
    if (!fs.existsSync(configPath)) {
      return {
        success: false,
        error: `Config file for ${interfaceName} not found`,
      };
    }

    // Read current config
    const configContent = fs.readFileSync(configPath, "utf8");

    // Check if the public key already exists
    if (configContent.includes(peerData.publicKey)) {
      return {
        success: false,
        error: "A peer with this public key already exists",
      };
    }

    // Create peer config section
    let peerSection = "\n[Peer]\n";
    if (peerData.name) {
      peerSection += `# Name: ${peerData.name}\n`;
    }
    peerSection += `PublicKey = ${peerData.publicKey}\n`;
    peerSection += `AllowedIPs = ${peerData.allowedIPs}\n`;

    if (peerData.endpoint) {
      peerSection += `Endpoint = ${peerData.endpoint}\n`;
    }

    if (peerData.persistentKeepalive) {
      peerSection += `PersistentKeepalive = ${peerData.persistentKeepalive}\n`;
    }

    // Append the new peer to the config file
    fs.appendFileSync(configPath, peerSection);

    // Apply the new config to the running interface
    await execPromise(`wg addconf ${interfaceName} <(echo "${peerSection}")`, {
      shell: "/bin/bash",
    });

    return {
      success: true,
      interface: interfaceName,
      message: `Peer added successfully to ${interfaceName}`,
      peer: {
        name: peerData.name || "Unnamed",
        publicKey: peerData.publicKey,
        allowedIPs: peerData.allowedIPs,
      },
    };
  } catch (error) {
    console.error(`Error adding peer to interface ${interfaceName}:`, error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Remove a peer from a WireGuard interface
 * @param {string} interfaceName - Name of the WireGuard interface
 * @param {string} publicKey - Public key of the peer to remove
 * @returns {Promise<Object>} Result of the remove operation
 */
async function removePeer(interfaceName, publicKey) {
  try {
    // Validate interface name for security
    if (!/^[a-zA-Z0-9_]+$/.test(interfaceName)) {
      return {
        success: false,
        error: "Invalid interface name",
      };
    }

    // Validate public key format
    if (!/^[a-zA-Z0-9+\/=]+$/.test(publicKey)) {
      return {
        success: false,
        error: "Invalid public key format",
      };
    }

    // Check if the interface exists
    const { stdout: wgOutput } = await execPromise("wg show interfaces");
    const interfaces = wgOutput.trim().split(/\s+/);

    if (!interfaces.includes(interfaceName)) {
      return {
        success: false,
        error: `Interface ${interfaceName} not found`,
      };
    }

    // Remove peer from the running interface
    await execPromise(`wg set ${interfaceName} peer ${publicKey} remove`);

    // Update the config file if it exists
    const configPath = `/etc/wireguard/${interfaceName}.conf`;
    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, "utf8");

      // Split the config into sections
      const sections = configContent.split(/\[(Peer|Interface)\]/i);

      // Find and remove the peer section
      let newConfig = "";
      let peerRemoved = false;

      for (let i = 0; i < sections.length; i++) {
        if (i === 0) {
          newConfig += sections[i];
          continue;
        }

        const sectionType = sections[i];
        const sectionContent = sections[i + 1] || "";

        if (
          sectionType.toLowerCase() === "peer" &&
          sectionContent.includes(`PublicKey = ${publicKey}`)
        ) {
          // Skip this peer section
          peerRemoved = true;
          i++; // Skip the content part too
        } else {
          newConfig += `[${sectionType}]${sectionContent}`;
        }
      }

      if (peerRemoved) {
        fs.writeFileSync(configPath, newConfig);
      }
    }

    return {
      success: true,
      interface: interfaceName,
      message: `Peer removed successfully from ${interfaceName}`,
      publicKey: publicKey,
    };
  } catch (error) {
    console.error(
      `Error removing peer from interface ${interfaceName}:`,
      error
    );
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Format bytes to human-readable format
 * @param {number} bytes - Number of bytes
 * @returns {string} Formatted size
 */
function formatBytes(bytes) {
  if (bytes === 0) return "0 B";

  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));

  return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Format handshake timestamp to human-readable time
 * @param {number} timestamp - Unix timestamp
 * @returns {string} Formatted time string
 */
function formatHandshakeTime(timestamp) {
  if (!timestamp) return "Never";

  const now = Math.floor(Date.now() / 1000);
  const secondsAgo = now - timestamp;

  if (secondsAgo < 60) return `${secondsAgo} seconds ago`;
  if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)} minutes ago`;
  if (secondsAgo < 86400) return `${Math.floor(secondsAgo / 3600)} hours ago`;

  return `${Math.floor(secondsAgo / 86400)} days ago`;
}

module.exports = {
  listInterfaces,
  getPeers,
  restartInterface,
  addPeer,
  removePeer,
};

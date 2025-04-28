const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * Get the appropriate tailscale command for the current platform
 * @param {string} subcommand The subcommand to run (e.g. "status", "up")
 * @param {Object} options Additional options
 * @returns {string} The command to execute
 */
function getTailscaleCommand(subcommand, options = {}) {
  const platform = process.platform;
  const { args = "", fallbackCheck = true } = options;

  let baseCommand;

  // Determine base command based on platform
  if (platform === "win32") {
    // Windows platform
    try {
      // Check if tailscale.exe is available in Program Files
      if (
        fallbackCheck &&
        fs.existsSync("C:\\Program Files\\Tailscale\\tailscale.exe")
      ) {
        baseCommand = '"C:\\Program Files\\Tailscale\\tailscale.exe"';
      } else {
        // Just use tailscale.exe and let the PATH resolve it
        baseCommand = "tailscale.exe";
      }
    } catch (error) {
      // Default to tailscale.exe if any error occurs
      console.log(
        `[getTailscaleCommand] Error checking tailscale path: ${error.message}`
      );
      baseCommand = "tailscale.exe";
    }
  } else {
    // Linux/macOS/other platforms
    baseCommand = "tailscale";
  }

  // Build the full command
  const fullCommand = `${baseCommand} ${subcommand}${args ? ` ${args}` : ""}`;
  console.log(
    `[getTailscaleCommand] Using command: ${fullCommand} for platform: ${platform}`
  );

  return fullCommand;
}

/**
 * Execute a Tailscale command with error handling
 * @param {string} subcommand The subcommand to run
 * @param {Object} options Additional options
 * @returns {string} The command output
 */
function executeTailscaleCommand(subcommand, options = {}) {
  const { args = "", timeout = 10000, shouldThrow = true } = options;

  try {
    // Get the appropriate command for this platform
    const command = getTailscaleCommand(subcommand, { args });

    // Execute the command
    const output = execSync(command, {
      timeout,
      shell: true,
    }).toString();

    return output;
  } catch (error) {
    console.error(
      `[executeTailscaleCommand] Error executing ${subcommand}: ${error.message}`
    );
    if (shouldThrow) {
      throw error;
    }
    return "";
  }
}

/**
 * Get Tailscale status including all connected nodes
 * @returns {Object} Tailscale status information
 */
async function getStatus() {
  try {
    // Run tailscale status command with JSON output
    const output = executeTailscaleCommand("status", { args: "--json" });
    const statusData = JSON.parse(output);

    // 調試: 記錄完整的 JSON 結構
    console.log("===== TAILSCALE DEBUG START =====");
    console.log("Raw statusData keys:", Object.keys(statusData));

    if (statusData.Self) {
      console.log("Self properties:", Object.keys(statusData.Self));
      console.log("Self.HostName:", statusData.Self.HostName);
      console.log("Self.OS:", statusData.Self.OS);
      console.log("Self.CanExitNode:", statusData.Self.CanExitNode);

      // 詳細打印 Self 物件的所有屬性和值
      console.log("==== Self Object Full Structure ====");
      Object.keys(statusData.Self).forEach((key) => {
        if (
          typeof statusData.Self[key] === "object" &&
          statusData.Self[key] !== null
        ) {
          console.log(
            `Self.${key} (object):`,
            JSON.stringify(statusData.Self[key], null, 2)
          );
        } else {
          console.log(`Self.${key}:`, statusData.Self[key]);
        }
      });
    }

    if (statusData.Peer) {
      console.log("Number of peers:", Object.keys(statusData.Peer).length);

      // 遍歷每個 peer，檢查完整結構
      for (const [id, peer] of Object.entries(statusData.Peer)) {
        console.log(
          `\n==== PEER FULL STRUCTURE: ${peer.HostName || "Unnamed"} ====`
        );
        console.log(`ID: ${id}`);

        // 打印 peer 的所有屬性和值
        Object.keys(peer).forEach((key) => {
          if (typeof peer[key] === "object" && peer[key] !== null) {
            console.log(`${key} (object):`, JSON.stringify(peer[key], null, 2));
          } else {
            console.log(`${key}:`, peer[key]);
          }
        });

        // 特別關注可能與 Exit Node 有關的屬性
        console.log(`\nExit Node Related Properties for ${peer.HostName}:`);
        console.log(`ExitNode:`, peer.ExitNode);
        console.log(`CanExitNode:`, peer.CanExitNode);
        console.log(`IsExitNode:`, peer.IsExitNode);
        console.log(`AllowedIPs:`, peer.AllowedIPs);

        if (peer.Capabilities) {
          console.log(`Capabilities:`, peer.Capabilities);
        }

        if (peer.CapMap) {
          console.log(`CapMap:`, peer.CapMap);
        }
      }
    }
    console.log("===== TAILSCALE DEBUG END =====");

    // Format the data for easier consumption
    const formattedStatus = {
      self: {}, // Will store information about this device
      peers: [],
      success: true,
    };

    // 首先處理本機資訊，從 Self 物件獲取資料
    if (statusData.Self) {
      // 獲取本機IP
      const selfIPs = statusData.Self.TailscaleIPs || [];
      // 獲取本機ID（如果可用）
      const selfID = statusData.Self.ID;

      // 構建本機資訊
      formattedStatus.self = {
        id: selfID,
        hostname: statusData.Self.HostName || "This Device",
        ip: selfIPs.join(", "),
        os: statusData.Self.OS || "Unknown",
        exitNode: !!statusData.Self.CanExitNode,
        online: true, // 自身肯定在線
        rxBytes: statusData.Self.RxBytes,
        txBytes: statusData.Self.TxBytes,
        exitNodeIP: statusData.Self.ExitNodeIP || null,
        usingExitNode: !!statusData.Self.ExitNodeIP,
      };
    }

    // 處理 peers 資訊
    if (statusData.Peer) {
      // Process each peer in the status
      for (const [id, peer] of Object.entries(statusData.Peer)) {
        // 增強版的 Exit Node 判斷邏輯
        let isExitNode = false;
        let exitNodeReason = null;

        // 檢查各種可能的 Exit Node 標識方式
        if (peer.ExitNode) {
          isExitNode = true;
          exitNodeReason = "ExitNode";
        } else if (peer.IsExitNode) {
          isExitNode = true;
          exitNodeReason = "IsExitNode";
        } else if (peer.CanExitNode) {
          isExitNode = true;
          exitNodeReason = "CanExitNode";
        } else if (peer.AdvertisesExitNode) {
          isExitNode = true;
          exitNodeReason = "AdvertisesExitNode";
        } else if (
          peer.AllowedIPs &&
          (peer.AllowedIPs.includes("0.0.0.0/0") ||
            peer.AllowedIPs.includes("::/0"))
        ) {
          // 如果 AllowedIPs 包含預設路由，這通常表示它可以作為 Exit Node
          isExitNode = true;
          exitNodeReason = "AllowedIPs";
        }

        // 檢查 Capabilities 陣列
        if (!isExitNode && peer.Capabilities) {
          if (
            typeof peer.Capabilities === "object" &&
            Array.isArray(peer.Capabilities)
          ) {
            if (
              peer.Capabilities.includes("exit-node") ||
              peer.Capabilities.includes("route") ||
              peer.Capabilities.includes("subnet-router")
            ) {
              isExitNode = true;
              exitNodeReason = "Capabilities";
            }
          }
        }

        // 檢查 CapMap 對象
        if (!isExitNode && peer.CapMap) {
          if (typeof peer.CapMap === "object") {
            if (
              peer.CapMap["exit-node"] ||
              peer.CapMap["route"] ||
              peer.CapMap["subnet-router"]
            ) {
              isExitNode = true;
              exitNodeReason = "CapMap";
            }
          }
        }

        // 檢查 Tags 陣列
        if (!isExitNode && peer.Tags) {
          if (typeof peer.Tags === "object" && Array.isArray(peer.Tags)) {
            if (
              peer.Tags.includes("exit-node") ||
              peer.Tags.includes("exit_node") ||
              peer.Tags.includes("route")
            ) {
              isExitNode = true;
              exitNodeReason = "Tags";
            }
          }
        }

        // 檢查 StableID
        if (!isExitNode && peer.StableID && peer.StableID.startsWith("exit_")) {
          isExitNode = true;
          exitNodeReason = "StableID";
        }

        // 基於設備名稱的啟發式檢查（最後手段）
        if (!isExitNode) {
          const hostname = peer.HostName || "";
          if (
            hostname.toLowerCase().includes("exit") ||
            hostname.toLowerCase().includes("router") ||
            hostname.toLowerCase().includes("gateway")
          ) {
            console.log(`[getStatus] 根據主機名，${hostname} 可能是 Exit Node`);
          }
        }

        // 打印结果
        if (isExitNode) {
          console.log(
            `[getStatus] 發現 Exit Node: ${peer.HostName}, 識別方式: ${exitNodeReason}`
          );
        } else {
          console.log(`[getStatus] ${peer.HostName} 不是 Exit Node`);
        }

        const peerInfo = {
          id,
          hostname: peer.HostName,
          ip: peer.TailscaleIPs ? peer.TailscaleIPs.join(", ") : "",
          os: peer.OS,
          exitNode: isExitNode, // 使用擴展的檢測邏輯
          exitNodeType: exitNodeReason, // 記錄識別方式，幫助調試
          online: !!peer.Online,
          lastSeen: peer.LastSeen
            ? new Date(peer.LastSeen).toISOString()
            : null,
          rxBytes: peer.RxBytes,
          txBytes: peer.TxBytes,
        };

        // 將 peer 資訊加入 peers 列表
        formattedStatus.peers.push(peerInfo);
      }
    }

    // 調試: 記錄格式化後的狀態，特別是 exit node 資訊
    console.log("===== FORMATTED STATUS DEBUG =====");
    console.log(`Total peers: ${formattedStatus.peers.length}`);
    console.log("Peers with exit node capability:");
    formattedStatus.peers
      .filter((p) => p.exitNode)
      .forEach((p) => {
        console.log(`- ${p.hostname} (online: ${p.online})`);
      });
    console.log("Eligible exit nodes (exitNode=true and online=true):");
    formattedStatus.peers
      .filter((p) => p.exitNode && p.online)
      .forEach((p) => {
        console.log(`- ${p.hostname} (${p.ip})`);
      });
    console.log("===== FORMATTED STATUS DEBUG END =====");

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
 * 嘗試使用 Tailscale 的專用 API 直接獲取可用的 Exit Nodes
 * 這是較新版本 Tailscale 中提供的功能
 * @returns {Promise<Array>} Exit Node 列表
 */
async function getExitNodesList() {
  try {
    console.log("[getExitNodesList] Attempting to get exit nodes list");

    // Use the correct command: exit-node list (not exit-nodes)
    // and don't use the --json flag since it's not supported
    let output;
    try {
      output = executeTailscaleCommand("exit-node", { args: "list" });
    } catch (error) {
      console.log(
        "[getExitNodesList] Exit node list command failed:",
        error.message
      );
      return [];
    }

    // Process the text output since it's not JSON
    let exitNodes = [];

    // Parse text format output
    const lines = output
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .filter((line) => !line.includes("No exit nodes available"))
      // Filter out help/hint lines that start with # or contain common help text
      .filter(
        (line) =>
          !line.trim().startsWith("#") &&
          !line.includes("(To)") &&
          !line.includes("Usage:") &&
          !line.includes("Options:")
      );

    console.log("[getExitNodesList] Raw output lines:", lines.length);

    if (lines.length > 0) {
      // Check if there's a header row
      const hasHeader =
        lines[0].includes("IP") ||
        lines[0].includes("NAME") ||
        lines[0].toLowerCase().includes("hostname");

      // Start from line 1 if there's a header, otherwise from line 0
      const dataLines = hasHeader ? lines.slice(1) : lines;

      dataLines.forEach((line) => {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          // Determine which part is IP and which is hostname based on format
          let ip, hostname;

          // First part looks like an IP address (has dots or colons)
          if (parts[0].includes(".") || parts[0].includes(":")) {
            ip = parts[0];
            // The hostname might be the rest of the line combined
            hostname = parts.slice(1).join(" ");
          } else {
            // Otherwise assume hostname first, then IP
            hostname = parts[0];
            ip = parts[1];
          }

          // Skip entries that don't look like valid IPs or hostnames
          if (
            ip &&
            hostname &&
            (ip.includes(".") || ip.includes(":")) &&
            !hostname.includes("(To)") &&
            !hostname.includes("Usage:")
          ) {
            exitNodes.push({
              hostname: hostname,
              ip: ip,
              online: true, // Assume listed nodes are online
            });
          }
        }
      });
    }

    console.log(
      `[getExitNodesList] Found ${exitNodes.length} valid exit nodes`
    );
    return exitNodes;
  } catch (error) {
    console.error("[getExitNodesList] Error:", error);
    return [];
  }
}

/**
 * Extract the first valid IPv4 address from a string that might contain multiple IPs
 * @param {string} ipString String containing one or more IP addresses
 * @returns {string} The first IPv4 address, or the original string if no IPv4 is found
 */
function extractFirstIPv4(ipString) {
  if (!ipString) return "";

  // Look for IPv4 pattern (simple regex)
  const ipv4Regex = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
  const match = ipString.match(ipv4Regex);

  if (match && match[0]) {
    console.log(
      `[extractFirstIPv4] Found IPv4 address: ${match[0]} from "${ipString}"`
    );
    return match[0];
  }

  // If no IPv4 found, try to get the first part before any comma or space
  const firstPart = ipString.split(/[,\s]/)[0];
  console.log(
    `[extractFirstIPv4] No IPv4 match found, using first part: ${firstPart}`
  );
  return firstPart;
}

/**
 * Enable a specific device as Exit Node
 * @param {string} hostname The hostname of the device to use as exit node
 * @param {string} [specifiedIp] Optional IP address to use instead of looking it up
 * @returns {Object} Result of the operation
 */
async function enableExitNode(hostname, specifiedIp) {
  try {
    console.log(
      `[enableExitNode] Starting for hostname: ${hostname}${
        specifiedIp ? `, IP: ${specifiedIp}` : ""
      }`
    );

    // Check environment
    const platform = process.platform;
    console.log(`[enableExitNode] Platform: ${platform}`);

    // Try to verify tailscale is running - only if we have a valid target
    // Get a list of peers to use as ping targets
    let pingTarget = null;
    try {
      const status = await getStatus();
      if (status && status.peers && status.peers.length > 0) {
        // Use the first online peer as a ping target
        const onlinePeer = status.peers.find((peer) => peer.online);
        if (onlinePeer && onlinePeer.ip) {
          pingTarget = onlinePeer.ip.split(",")[0].trim(); // Get first IP if multiple
        }
      }

      // If we found a valid target, try to ping it
      if (pingTarget) {
        console.log(`[enableExitNode] Using ${pingTarget} as ping target`);
        const pingOutput = executeTailscaleCommand("ping", {
          args: pingTarget,
          shouldThrow: false,
        });
        if (pingOutput) {
          console.log("[enableExitNode] Tailscale is responsive");
        }
      } else {
        console.log(
          "[enableExitNode] No valid ping target available, skipping ping check"
        );
      }
    } catch (pingError) {
      console.log(
        "[enableExitNode] Tailscale ping check failed:",
        pingError.message
      );
    }

    // 先嘗試使用專用 API 獲取 exit nodes 列表
    const exitNodesList = await getExitNodesList();
    console.log(
      `[enableExitNode] Exit nodes API returned ${exitNodesList.length} nodes`
    );

    if (exitNodesList.length > 0) {
      // 找到匹配的 exit node
      const matchedNode = exitNodesList.find(
        (node) => node.hostname === hostname
      );
      if (matchedNode) {
        console.log(
          `[enableExitNode] Found matching exit node: ${JSON.stringify(
            matchedNode
          )}`
        );
      } else {
        console.log(
          `[enableExitNode] Hostname not found in exit nodes list: ${hostname}`
        );
        console.log(
          "Available exit nodes:",
          exitNodesList.map((n) => n.hostname)
        );
      }
    }

    // If a specific IP was provided, use it directly
    if (specifiedIp) {
      // Extract first IPv4 address from potentially multiple addresses
      const ipToUse = extractFirstIPv4(specifiedIp);
      console.log(
        `[enableExitNode] Using IP address: ${ipToUse} (extracted from: ${specifiedIp})`
      );

      // Set up the exit node with the specified IP
      const output = executeTailscaleCommand("up", {
        args: `--exit-node=${ipToUse}`,
        timeout: 15000,
      });

      console.log(`[enableExitNode] Command output: ${output}`);

      return {
        success: true,
        message: `Successfully set ${hostname} as exit node`,
        ip: ipToUse,
        output: output,
      };
    }

    // 繼續使用原有流程作為備用
    // First check if the hostname exists
    const status = await getStatus();
    if (!status.success) {
      return {
        success: false,
        error: "Failed to check Tailscale status",
        details: status.error,
      };
    }

    // 獲取可用的 exit nodes 並詳細輸出日誌
    const eligibleExitNodes = status.peers.filter(
      (p) => p.exitNode && p.online
    );
    console.log(
      `[enableExitNode] Found ${eligibleExitNodes.length} eligible exit nodes`
    );

    // Find the peer with the specified hostname
    const peer = status.peers.find((p) => p.hostname === hostname);
    if (!peer) {
      return {
        success: false,
        error: `No peer found with hostname: ${hostname}`,
        availableHosts: status.peers
          .filter((p) => p.exitNode && p.online)
          .map((p) => p.hostname),
      };
    }

    // Print peer details for debugging
    console.log(
      `[enableExitNode] Selected peer details:`,
      JSON.stringify(peer, null, 2)
    );

    // Check if the peer can be used as an exit node
    if (!peer.exitNode) {
      return {
        success: false,
        error: `Peer '${hostname}' is not configured as an exit node`,
        suggestion:
          "This peer must have exit node capability enabled in Tailscale admin",
        availableHosts: status.peers
          .filter((p) => p.exitNode && p.online)
          .map((p) => p.hostname),
      };
    }

    // Check if the peer is online
    if (!peer.online) {
      return {
        success: false,
        error: `Peer '${hostname}' is currently offline`,
        suggestion: "Choose an online peer to use as exit node",
        availableHosts: status.peers
          .filter((p) => p.exitNode && p.online)
          .map((p) => p.hostname),
      };
    }

    // Ensure we have valid IP to use
    if (!peer.ip) {
      return {
        success: false,
        error: `Peer '${hostname}' has no valid IP address`,
        availableHosts: status.peers
          .filter((p) => p.exitNode && p.online && p.ip)
          .map((p) => p.hostname),
      };
    }

    // Extract the first IPv4 address if there are multiple
    const exitNodeIP = extractFirstIPv4(peer.ip);
    console.log(
      `[enableExitNode] Setting up exit node: ${hostname} with IP: ${exitNodeIP}`
    );

    // Set up the exit node using the helper function
    const output = executeTailscaleCommand("up", {
      args: `--exit-node=${exitNodeIP}`,
      timeout: 15000,
    });

    console.log(`[enableExitNode] Command output: ${output}`);

    return {
      success: true,
      message: `Successfully set ${hostname} as exit node`,
      ip: exitNodeIP,
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
    console.log("[disableExitNode] Disabling exit node");

    // Execute the command to disable the exit node
    const output = executeTailscaleCommand("up", {
      args: `--exit-node=`,
      timeout: 15000,
    });

    console.log("[disableExitNode] Command output:", output);

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
      command: "tailscale up --exit-node=",
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
    let pingStats = "";
    try {
      // Use different ping commands based on platform
      if (process.platform === "win32") {
        pingStats = execSync("ping -n 4 8.8.8.8", {
          timeout: 10000,
        }).toString();
      } else {
        pingStats = execSync("ping -c 4 8.8.8.8", {
          timeout: 10000,
        }).toString();
      }
    } catch (pingError) {
      console.log("[getNetStats] Ping failed:", pingError.message);
    }

    // Get interface statistics based on platform
    let ifconfigOutput = "";
    try {
      if (process.platform === "win32") {
        // On Windows, try to get interface stats using netsh
        ifconfigOutput = execSync(
          "netsh interface ipv4 show interface tailscale",
          { timeout: 10000 }
        ).toString();
      } else if (process.platform === "darwin") {
        // macOS
        ifconfigOutput = execSync("ifconfig utun | grep -A 6 tailscale", {
          timeout: 10000,
          shell: true,
        }).toString();
      } else {
        // Linux and others
        ifconfigOutput = execSync(
          "ifconfig tailscale0 || ip -s link show tailscale0",
          { timeout: 10000, shell: true }
        ).toString();
      }
    } catch (ifError) {
      console.log("[getNetStats] Interface stats failed:", ifError.message);
    }

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
    let output = "";

    if (process.platform === "win32") {
      // Windows: Start Tailscale service
      try {
        output +=
          execSync("net start tailscale", { timeout: 10000 }).toString() + "\n";
      } catch (serviceError) {
        console.log(
          "[startTailscale] Service start failed:",
          serviceError.message
        );
      }

      // Then run tailscale up
      output += executeTailscaleCommand("up", { timeout: 15000 });
    } else {
      // Linux/macOS: Start the service and run tailscale up
      try {
        output +=
          execSync("sudo systemctl start tailscaled", {
            timeout: 10000,
          }).toString() + "\n";
      } catch (serviceError) {
        console.log(
          "[startTailscale] Service start failed, trying alternative methods"
        );

        // Try service command as fallback
        try {
          output +=
            execSync("sudo service tailscaled start", {
              timeout: 10000,
            }).toString() + "\n";
        } catch (altError) {
          console.log(
            "[startTailscale] Alternative service start failed:",
            altError.message
          );
        }
      }

      // Run tailscale up regardless
      output += executeTailscaleCommand("up", { timeout: 15000 });
    }

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
      command: "Failed to start Tailscale service",
    };
  }
}

/**
 * Stop the Tailscale service
 * @returns {Object} Result of the operation
 */
async function stopTailscale() {
  try {
    let output = "";

    // First, run tailscale down
    output += executeTailscaleCommand("down", { timeout: 15000 }) + "\n";

    // Then stop the service based on platform
    if (process.platform === "win32") {
      try {
        output += execSync("net stop tailscale", { timeout: 10000 }).toString();
      } catch (stopError) {
        console.log("[stopTailscale] Service stop failed:", stopError.message);
      }
    } else {
      try {
        output += execSync("sudo systemctl stop tailscaled", {
          timeout: 10000,
        }).toString();
      } catch (stopError) {
        console.log(
          "[stopTailscale] Service stop failed, trying alternative methods"
        );

        // Try service command as fallback
        try {
          output += execSync("sudo service tailscaled stop", {
            timeout: 10000,
          }).toString();
        } catch (altError) {
          console.log(
            "[stopTailscale] Alternative service stop failed:",
            altError.message
          );
        }
      }
    }

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
      command: "Failed to stop Tailscale service",
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
  getExitNodesList,
  extractFirstIPv4,
};

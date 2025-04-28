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
    // 增加錯誤處理，並考慮 Windows 平台可能的不同指令路徑
    let output;
    try {
      // 先嘗試標準指令
      output = execSync("tailscale status --json", {
        timeout: 10000,
      }).toString();
    } catch (cmdError) {
      console.log(
        "標準 tailscale 指令失敗，嘗試替代指令路徑...",
        cmdError.message
      );

      try {
        // 嘗試 Windows 平台上的可能完整路徑
        output = execSync(
          '"C:\\Program Files\\Tailscale\\tailscale.exe" status --json',
          { timeout: 10000, shell: true }
        ).toString();
      } catch (winError) {
        console.log("Windows 路徑嘗試失敗，嘗試其他位置...", winError.message);

        // 最後嘗試一些常見替代位置
        output = execSync("tailscale.exe status --json", {
          timeout: 10000,
          shell: true,
        }).toString();
      }
    }

    const statusData = JSON.parse(output);

    // 調試: 記錄完整的 JSON 結構
    console.log("===== TAILSCALE DEBUG START =====");
    console.log("Raw statusData keys:", Object.keys(statusData));

    if (statusData.Self) {
      console.log("Self properties:", Object.keys(statusData.Self));
      console.log("Self.HostName:", statusData.Self.HostName);
      console.log("Self.OS:", statusData.Self.OS);
      console.log("Self.CanExitNode:", statusData.Self.CanExitNode);
    }

    if (statusData.Peer) {
      console.log("Number of peers:", Object.keys(statusData.Peer).length);

      // 遍歷每個 peer，檢查是否有 ExitNode 屬性
      for (const [id, peer] of Object.entries(statusData.Peer)) {
        console.log(`Peer ${peer.HostName}:`);
        console.log(`  ID: ${id}`);
        console.log(`  Online: ${peer.Online}`);
        console.log(`  ExitNode: ${peer.ExitNode}`);
        console.log(`  OS: ${peer.OS}`);
        console.log(
          `  IPs: ${peer.TailscaleIPs ? peer.TailscaleIPs.join(", ") : "None"}`
        );

        // 列出所有 peer 屬性，確保我們沒有遺漏任何重要信息
        console.log(`  All properties: ${Object.keys(peer).join(", ")}`);
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
        // 檢查 ExitNode 屬性，考慮可能的變種和其他方式
        // Tailscale 可能使用 ExitNode、IsExitNode、CanExitNode 或其他屬性名稱
        const isExitNode =
          !!peer.ExitNode ||
          !!peer.IsExitNode ||
          !!peer.CanExitNode ||
          (peer.Tags && peer.Tags.includes("exit-node")) ||
          (peer.Capabilities && peer.Capabilities.includes("exit-node"));

        // 檢查是否是正確的 Exit Node 類型 - 這是為了偵錯
        let exitNodeType = null;
        if (peer.ExitNode) exitNodeType = "ExitNode";
        else if (peer.IsExitNode) exitNodeType = "IsExitNode";
        else if (peer.CanExitNode) exitNodeType = "CanExitNode";
        else if (peer.Tags && peer.Tags.includes("exit-node"))
          exitNodeType = "Tags";
        else if (peer.Capabilities && peer.Capabilities.includes("exit-node"))
          exitNodeType = "Capabilities";

        if (isExitNode) {
          console.log(
            `${peer.HostName} 具有 Exit Node 功能，識別為: ${exitNodeType}`
          );
        }

        const peerInfo = {
          id,
          hostname: peer.HostName,
          ip: peer.TailscaleIPs ? peer.TailscaleIPs.join(", ") : "",
          os: peer.OS,
          exitNode: isExitNode, // 使用擴展的檢測邏輯
          exitNodeType: exitNodeType, // 記錄識別方式，幫助調試
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

    // 獲取可用的 exit nodes 並詳細輸出日誌
    const eligibleExitNodes = status.peers.filter(
      (p) => p.exitNode && p.online
    );
    console.log(
      `[enableExitNode] Found ${eligibleExitNodes.length} eligible exit nodes:`
    );
    eligibleExitNodes.forEach((node) => {
      console.log(
        `- ${node.hostname} (${node.ip}), Online: ${node.online}, ExitNode: ${
          node.exitNode
        }, Type: ${node.exitNodeType || "unknown"}`
      );
    });

    // 包含所有 peers 的資訊（用於調試）
    console.log(`[enableExitNode] All peers (${status.peers.length}):`);
    status.peers.forEach((node) => {
      console.log(
        `- ${node.hostname}: ExitNode=${node.exitNode}, Online=${
          node.online
        }, Type=${node.exitNodeType || "none"}`
      );
    });

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

    // Extract the first IP if there are multiple
    const exitNodeIP = peer.ip.split(",")[0].trim();
    console.log(
      `[enableExitNode] Setting up exit node: ${hostname} with IP: ${exitNodeIP}`
    );

    // Set up the exit node with錯誤處理
    let output;
    try {
      // 先嘗試標準指令
      output = execSync(`tailscale up --exit-node=${exitNodeIP}`, {
        timeout: 15000,
      }).toString();
    } catch (cmdError) {
      console.log(
        "[enableExitNode] 標準 tailscale 指令失敗，嘗試替代指令路徑...",
        cmdError.message
      );

      try {
        // 嘗試 Windows 平台上的可能完整路徑
        output = execSync(
          `"C:\\Program Files\\Tailscale\\tailscale.exe" up --exit-node=${exitNodeIP}`,
          { timeout: 15000, shell: true }
        ).toString();
      } catch (winError) {
        console.log(
          "[enableExitNode] Windows 路徑嘗試失敗，嘗試其他位置...",
          winError.message
        );

        // 最後嘗試一些常見替代位置
        output = execSync(`tailscale.exe up --exit-node=${exitNodeIP}`, {
          timeout: 15000,
          shell: true,
        }).toString();
      }
    }
    console.log(`[enableExitNode] Exit node command output: ${output}`);

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
    console.log("[disableExitNode] 嘗試禁用 Exit Node");

    // 使用類似的錯誤處理邏輯
    let output;
    try {
      // 先嘗試標準指令
      output = execSync('tailscale up --exit-node=""', {
        timeout: 15000,
      }).toString();
    } catch (cmdError) {
      console.log(
        "[disableExitNode] 標準 tailscale 指令失敗，嘗試替代指令路徑...",
        cmdError.message
      );

      try {
        // 嘗試 Windows 平台上的可能完整路徑
        output = execSync(
          '"C:\\Program Files\\Tailscale\\tailscale.exe" up --exit-node=""',
          { timeout: 15000, shell: true }
        ).toString();
      } catch (winError) {
        console.log(
          "[disableExitNode] Windows 路徑嘗試失敗，嘗試其他位置...",
          winError.message
        );

        // 最後嘗試一些常見替代位置
        output = execSync('tailscale.exe up --exit-node=""', {
          timeout: 15000,
          shell: true,
        }).toString();
      }
    }

    console.log("[disableExitNode] 指令輸出:", output);

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

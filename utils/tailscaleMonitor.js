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
    console.log("[getExitNodesList] 嘗試使用專用 API 獲取 Exit Nodes 列表");

    // 嘗試不同可能的命令
    let output;
    try {
      // 嘗試標準命令 (Linux/macOS)
      output = execSync("tailscale exit-nodes list --json", {
        timeout: 10000,
      }).toString();
    } catch (stdError) {
      console.log("[getExitNodesList] 標準命令失敗:", stdError.message);

      try {
        // 嘗試 Windows 完整路徑
        output = execSync(
          '"C:\\Program Files\\Tailscale\\tailscale.exe" exit-nodes list --json',
          { timeout: 10000, shell: true }
        ).toString();
      } catch (winError) {
        console.log(
          "[getExitNodesList] Windows 路徑嘗試失敗:",
          winError.message
        );

        try {
          // 嘗試 Windows 普通路徑
          output = execSync("tailscale.exe exit-nodes list --json", {
            timeout: 10000,
            shell: true,
          }).toString();
        } catch (winSimpleError) {
          console.log(
            "[getExitNodesList] Windows 簡單路徑嘗試失敗:",
            winSimpleError.message
          );

          // 最後嘗試不用 --json 參數
          output = execSync("tailscale exit-nodes list", {
            timeout: 10000,
            shell: true,
          }).toString();
        }
      }
    }

    // 如果輸出不是 JSON 格式，嘗試解析文本輸出
    let exitNodes = [];
    try {
      // 嘗試解析為 JSON
      exitNodes = JSON.parse(output);
      console.log(
        `[getExitNodesList] 成功解析 JSON，找到 ${exitNodes.length} 個 exit nodes`
      );
    } catch (jsonError) {
      console.log(
        "[getExitNodesList] 無法解析 JSON，嘗試解析文本輸出:",
        jsonError.message
      );

      // 如果不是 JSON，可能是文本格式，嘗試解析
      const lines = output
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .filter((line) => !line.includes("No exit nodes available"));

      if (lines.length > 1) {
        // 假設第一行是標題行
        const dataLines = lines.slice(1);
        dataLines.forEach((line) => {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 2) {
            exitNodes.push({
              hostname: parts[0],
              ip: parts[1],
              online: true, // 假設列出的都是在線的
            });
          }
        });

        console.log(
          `[getExitNodesList] 從文本解析出 ${exitNodes.length} 個 exit nodes`
        );
      }
    }

    return exitNodes;
  } catch (error) {
    console.error("[getExitNodesList] 獲取 Exit Nodes 列表失敗:", error);
    return [];
  }
}

/**
 * Enable a specific device as Exit Node
 * @param {string} hostname The hostname of the device to use as exit node
 * @param {string} [specifiedIp] Optional IP address to use instead of looking it up
 * @returns {Object} Result of the operation
 */
async function enableExitNode(hostname, specifiedIp) {
  try {
    // 先嘗試使用專用 API 獲取 exit nodes 列表
    const exitNodesList = await getExitNodesList();
    console.log(
      `[enableExitNode] 專用 API 返回了 ${exitNodesList.length} 個 exit nodes`
    );

    if (exitNodesList.length > 0) {
      // 找到匹配的 exit node
      const matchedNode = exitNodesList.find(
        (node) => node.hostname === hostname
      );
      if (matchedNode) {
        console.log(
          `[enableExitNode] 找到匹配的 exit node: ${JSON.stringify(
            matchedNode
          )}`
        );
      } else {
        console.log(`[enableExitNode] 在 exit nodes 列表中未找到: ${hostname}`);
        console.log(
          "可用的 exit nodes:",
          exitNodesList.map((n) => n.hostname)
        );
      }
    }

    // If a specific IP was provided, use it directly
    if (specifiedIp) {
      console.log(`[enableExitNode] Using provided IP address: ${specifiedIp}`);

      // Set up the exit node with the specified IP
      let output;
      try {
        // 先嘗試標準指令
        output = execSync(`tailscale up --exit-node=${specifiedIp}`, {
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
            `"C:\\Program Files\\Tailscale\\tailscale.exe" up --exit-node=${specifiedIp}`,
            { timeout: 15000, shell: true }
          ).toString();
        } catch (winError) {
          console.log(
            "[enableExitNode] Windows 路徑嘗試失敗，嘗試其他位置...",
            winError.message
          );

          // 最後嘗試一些常見替代位置
          output = execSync(`tailscale.exe up --exit-node=${specifiedIp}`, {
            timeout: 15000,
            shell: true,
          }).toString();
        }
      }
      console.log(`[enableExitNode] Exit node command output: ${output}`);

      return {
        success: true,
        message: `Successfully set ${hostname} as exit node`,
        ip: specifiedIp,
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
  getExitNodesList,
};

const {
  SlashCommandBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} = require("discord.js");
const tailscaleMonitor = require("../utils/tailscaleMonitor");
const embedBuilder = require("../utils/embedBuilder");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("tailscale")
    .setDescription("Control and monitor Tailscale VPN")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("status")
        .setDescription("Display status of all Tailscale nodes")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("network")
        .setDescription("Show Tailscale network statistics")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("exit-node")
        .setDescription("Control exit node functionality")
        .addStringOption((option) =>
          option
            .setName("action")
            .setDescription("Action to take with exit node")
            .setRequired(true)
            .addChoices(
              { name: "on", value: "on" },
              { name: "off", value: "off" }
            )
        )
        .addStringOption((option) =>
          option
            .setName("hostname")
            .setDescription(
              'Hostname of the node to use as exit node (required when action is "on")'
            )
            .setRequired(false)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("start").setDescription("Start Tailscale service")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("stop").setDescription("Stop Tailscale service")
    ),

  async autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);

    if (focusedOption.name === "hostname") {
      try {
        // 嘗試使用專用 API 獲取 exit nodes 列表 - 這通常更快速
        const exitNodesList = await tailscaleMonitor.getExitNodesList();

        if (exitNodesList.length > 0) {
          // 直接使用 exitNodesList 作為選項
          const options = exitNodesList.map((node) => ({
            name: `${node.hostname} (${node.ip || "unknown IP"})`,
            value: node.hostname,
          }));

          // 過濾基於用戶輸入
          const filtered = options.filter((choice) =>
            choice.name
              .toLowerCase()
              .includes(focusedOption.value.toLowerCase())
          );

          await interaction.respond(filtered);
          return;
        }

        // 如果專用 API 未返回任何結果，使用常規方法
        const status = await tailscaleMonitor.getStatus();

        if (!status.success) {
          console.error("[autocomplete] Tailscale status error:", status.error);
          await interaction.respond([
            { name: "Error: Could not fetch Tailscale nodes", value: "error" },
          ]);
          return;
        }

        // Filter nodes that can be exit nodes and are online
        const exitNodes = status.peers
          .filter((peer) => peer.exitNode && peer.online)
          .map((peer) => ({
            name: `${peer.hostname} (${peer.exitNodeType || "exit node"})`,
            value: peer.hostname,
          }));

        // 如果沒有找到 exit nodes，檢查原因並給出特定訊息
        if (exitNodes.length === 0) {
          // 檢查是否有任何 peers 是 exit node（不考慮在線狀態）
          const anyExitNodes = status.peers.filter((peer) => peer.exitNode);
          if (anyExitNodes.length > 0) {
            await interaction.respond([
              {
                name: "Found exit nodes but they are offline",
                value: "offline",
              },
            ]);
            return;
          }

          // 添加一個選項來手動指定一個 peer 作為 exit node（如果有 peers）
          if (status.peers.length > 0) {
            const onlinePeers = status.peers.filter((peer) => peer.online);
            if (onlinePeers.length > 0) {
              const options = onlinePeers.map((peer) => ({
                name: `Try: ${peer.hostname} (${peer.ip || "unknown IP"})`,
                value: peer.hostname,
              }));

              await interaction.respond([
                {
                  name: "No detected exit nodes, but you can try these online peers:",
                  value: "try_online",
                },
                ...options,
              ]);
              return;
            }

            await interaction.respond([
              {
                name: "Found peers but none are configured as exit nodes",
                value: "no-exit-nodes",
              },
            ]);
            return;
          }

          await interaction.respond([
            { name: "No eligible exit nodes found", value: "none" },
          ]);
          return;
        }

        // Filter based on user input
        const filtered = exitNodes.filter((choice) =>
          choice.name.toLowerCase().includes(focusedOption.value.toLowerCase())
        );

        await interaction.respond(filtered);
      } catch (error) {
        console.error("[autocomplete] Error in autocomplete:", error);
        try {
          await interaction.respond([
            {
              name: "Error occurred: " + error.message.substring(0, 80),
              value: "error",
            },
          ]);
        } catch (respondError) {
          console.error("[autocomplete] Failed to respond:", respondError);
        }
      }
    }
  },

  async execute(interaction) {
    try {
      // 立即回應，防止 Discord 互動超時
      await interaction.deferReply();

      const subcommand = interaction.options.getSubcommand();

      switch (subcommand) {
        case "status":
          return await this.handleStatus(interaction);
        case "network":
          return await this.handleNetwork(interaction);
        case "exit-node":
          return await this.handleExitNode(interaction);
        case "start":
          return await this.handleStart(interaction);
        case "stop":
          return await this.handleStop(interaction);
        default:
          await interaction.editReply({ content: "Unknown subcommand." });
      }
    } catch (error) {
      console.error(`Error executing Tailscale command:`, error);

      try {
        // 確保無論如何都回應互動
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: `An error occurred: ${error.message}`,
            flags: { ephemeral: true },
          });
        } else if (interaction.deferred) {
          await interaction.editReply({
            content: `An error occurred: ${error.message}`,
          });
        }
      } catch (replyError) {
        console.error(`Failed to send error response:`, replyError);
      }
    }
  },

  async handleStatus(interaction) {
    try {
      const status = await tailscaleMonitor.getStatus();
      const embed = embedBuilder.createTailscaleStatusEmbed(status);

      // Create refresh button
      const refreshButton = new ButtonBuilder()
        .setCustomId("refresh_tailscale_status")
        .setLabel("Refresh")
        .setStyle(ButtonStyle.Primary);

      // Create network stats button
      const networkButton = new ButtonBuilder()
        .setCustomId("tailscale_network_stats")
        .setLabel("Network Stats")
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder().addComponents(
        refreshButton,
        networkButton
      );

      await interaction.editReply({ embeds: [embed], components: [row] });
    } catch (error) {
      console.error("[handleStatus] Error:", error);
      try {
        await interaction.editReply({
          content: `Error getting Tailscale status: ${error.message}`,
        });
      } catch (replyError) {
        console.error("[handleStatus] Error sending reply:", replyError);
      }
    }
  },

  async handleNetwork(interaction) {
    try {
      const netStats = await tailscaleMonitor.getNetStats();
      const embed = embedBuilder.createTailscaleNetStatsEmbed(netStats);

      // Create refresh button
      const refreshButton = new ButtonBuilder()
        .setCustomId("refresh_tailscale_network")
        .setLabel("Refresh")
        .setStyle(ButtonStyle.Primary);

      // Create status button
      const statusButton = new ButtonBuilder()
        .setCustomId("tailscale_status")
        .setLabel("Status")
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder().addComponents(
        refreshButton,
        statusButton
      );

      await interaction.editReply({ embeds: [embed], components: [row] });
    } catch (error) {
      console.error("[handleNetwork] Error:", error);
      try {
        await interaction.editReply({
          content: `Error getting network statistics: ${error.message}`,
        });
      } catch (replyError) {
        console.error("[handleNetwork] Error sending reply:", replyError);
      }
    }
  },

  async handleExitNode(interaction) {
    try {
      const action = interaction.options.getString("action");
      const hostname = interaction.options.getString("hostname");

      // Handle the "off" action
      if (action === "off") {
        console.log("[handleExitNode] Disabling exit node");

        try {
          const result = await tailscaleMonitor.disableExitNode();

          if (result.success) {
            await interaction.editReply({
              embeds: [embedBuilder.buildExitNodeEmbed("disabled", null)],
            });
          } else {
            await interaction.editReply({
              content: `Failed to disable exit node: ${result.error}`,
              flags: { ephemeral: true },
            });
          }
        } catch (disableError) {
          console.error(
            "[handleExitNode] Error disabling exit node:",
            disableError
          );
          await interaction.editReply({
            content: `Failed to disable exit node: ${disableError.message}`,
            flags: { ephemeral: true },
          });
        }
        return;
      }

      // For "on" action, we need a hostname
      if (!hostname || hostname === "none") {
        await interaction.editReply({
          content: "Please select a valid exit node from the dropdown list.",
          flags: { ephemeral: true },
        });
        return;
      }

      if (
        hostname === "error" ||
        hostname === "offline" ||
        hostname === "no-exit-nodes"
      ) {
        await interaction.editReply({
          content: "Please select a valid exit node from the dropdown list.",
          flags: { ephemeral: true },
        });
        return;
      }

      console.log(`[handleExitNode] Setting exit node to: ${hostname}`);

      try {
        // 先嘗試使用專用 API 獲取 exit nodes 列表
        const exitNodesList = await tailscaleMonitor.getExitNodesList();

        let targetNode = null;

        // 如果 API 返回結果，使用它來查找目標節點
        if (exitNodesList.length > 0) {
          targetNode = exitNodesList.find((node) => node.hostname === hostname);
          console.log(
            `[handleExitNode] 從專用 API 查找節點 ${hostname}: ${
              targetNode ? "找到" : "未找到"
            }`
          );
        }

        // 如果 API 未找到，使用常規 status 查找
        if (!targetNode) {
          console.log(`[handleExitNode] 從常規 status 查找節點 ${hostname}`);
          const status = await tailscaleMonitor.getStatus();

          if (!status.success) {
            await interaction.editReply({
              content: `Failed to get Tailscale status: ${status.error}`,
              flags: { ephemeral: true },
            });
            return;
          }

          // 查找對應的 peer
          targetNode = status.peers.find((peer) => peer.hostname === hostname);
        }

        // 檢查是否找到了目標節點
        if (!targetNode) {
          console.log(`[handleExitNode] 無法找到節點 ${hostname}`);
          await interaction.editReply({
            content: `Could not find a node with hostname: ${hostname}`,
            flags: { ephemeral: true },
          });
          return;
        }

        console.log(
          `[handleExitNode] 使用節點 ${targetNode.hostname} (${targetNode.ip})`
        );

        // 激活 exit node
        const result = await tailscaleMonitor.enableExitNode(
          hostname,
          targetNode.ip
        );

        if (result.success) {
          await interaction.editReply({
            embeds: [embedBuilder.buildExitNodeEmbed("enabled", targetNode)],
          });
        } else {
          await interaction.editReply({
            content: `Failed to set exit node: ${result.error}`,
            flags: { ephemeral: true },
          });
        }
      } catch (enableError) {
        console.error(
          "[handleExitNode] Error enabling exit node:",
          enableError
        );
        await interaction.editReply({
          content: `Error enabling exit node: ${enableError.message}`,
          flags: { ephemeral: true },
        });
      }
    } catch (error) {
      console.error("[handleExitNode] Error:", error);
      try {
        await interaction.editReply({
          content: `An error occurred: ${error.message}`,
          flags: { ephemeral: true },
        });
      } catch (replyError) {
        console.error("[handleExitNode] Error sending reply:", replyError);
      }
    }
  },

  async handleStart(interaction) {
    try {
      const result = await tailscaleMonitor.startTailscale();
      const embed = embedBuilder.createTailscaleOperationEmbed(result, "start");

      // Create buttons
      const statusButton = new ButtonBuilder()
        .setCustomId("tailscale_status")
        .setLabel("View Status")
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(statusButton);

      await interaction.editReply({ embeds: [embed], components: [row] });
    } catch (error) {
      console.error("[handleStart] Error:", error);
      try {
        await interaction.editReply({
          content: `Error starting Tailscale: ${error.message}`,
        });
      } catch (replyError) {
        console.error("[handleStart] Error sending reply:", replyError);
      }
    }
  },

  async handleStop(interaction) {
    try {
      // Create confirmation buttons first
      const confirmButton = new ButtonBuilder()
        .setCustomId("confirm_tailscale_stop")
        .setLabel("Confirm Stop")
        .setStyle(ButtonStyle.Danger);

      const cancelButton = new ButtonBuilder()
        .setCustomId("cancel_tailscale_stop")
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder().addComponents(
        confirmButton,
        cancelButton
      );

      await interaction.editReply({
        content:
          "⚠️ **Warning**: Stopping Tailscale will disconnect you from the Tailscale network. Are you sure?",
        components: [row],
      });
    } catch (error) {
      console.error("[handleStop] Error:", error);
      try {
        await interaction.editReply({
          content: `Error preparing stop confirmation: ${error.message}`,
        });
      } catch (replyError) {
        console.error("[handleStop] Error sending reply:", replyError);
      }
    }
  },

  // Handle button interactions for this command
  async handleInteraction(interaction) {
    const customId = interaction.customId;

    // 不需要在這裡調用 deferUpdate，因為 interactionCreate.js 已經處理了
    // 只處理互動邏輯
    try {
      // Refresh Tailscale status button
      if (
        customId === "refresh_tailscale_status" ||
        customId === "tailscale_status"
      ) {
        try {
          const status = await tailscaleMonitor.getStatus();
          const embed = embedBuilder.createTailscaleStatusEmbed(status);

          // Create refresh button
          const refreshButton = new ButtonBuilder()
            .setCustomId("refresh_tailscale_status")
            .setLabel("Refresh")
            .setStyle(ButtonStyle.Primary);

          // Create network stats button
          const networkButton = new ButtonBuilder()
            .setCustomId("tailscale_network_stats")
            .setLabel("Network Stats")
            .setStyle(ButtonStyle.Secondary);

          const row = new ActionRowBuilder().addComponents(
            refreshButton,
            networkButton
          );

          await interaction.editReply({
            embeds: [embed],
            components: [row],
            content: null,
          });
        } catch (statusError) {
          console.error("[handleInteraction] Status error:", statusError);
          await interaction.editReply({
            content: `Error refreshing status: ${statusError.message}`,
            components: [],
          });
        }
        return true;
      }

      // Refresh Tailscale network stats button
      else if (
        customId === "refresh_tailscale_network" ||
        customId === "tailscale_network_stats"
      ) {
        try {
          const netStats = await tailscaleMonitor.getNetStats();
          const embed = embedBuilder.createTailscaleNetStatsEmbed(netStats);

          // Create refresh button
          const refreshButton = new ButtonBuilder()
            .setCustomId("refresh_tailscale_network")
            .setLabel("Refresh")
            .setStyle(ButtonStyle.Primary);

          // Create status button
          const statusButton = new ButtonBuilder()
            .setCustomId("tailscale_status")
            .setLabel("Status")
            .setStyle(ButtonStyle.Secondary);

          const row = new ActionRowBuilder().addComponents(
            refreshButton,
            statusButton
          );

          await interaction.editReply({
            embeds: [embed],
            components: [row],
            content: null,
          });
        } catch (networkError) {
          console.error(
            "[handleInteraction] Network stats error:",
            networkError
          );
          await interaction.editReply({
            content: `Error refreshing network stats: ${networkError.message}`,
            components: [],
          });
        }
        return true;
      }

      // Confirm stop Tailscale
      else if (customId === "confirm_tailscale_stop") {
        try {
          const result = await tailscaleMonitor.stopTailscale();
          const embed = embedBuilder.createTailscaleOperationEmbed(
            result,
            "stop"
          );

          // Create button to start Tailscale
          const startButton = new ButtonBuilder()
            .setCustomId("confirm_tailscale_start")
            .setLabel("Start Tailscale")
            .setStyle(ButtonStyle.Success);

          const row = new ActionRowBuilder().addComponents(startButton);

          await interaction.editReply({
            embeds: [embed],
            components: [row],
            content: null,
          });
        } catch (stopError) {
          console.error("[handleInteraction] Stop error:", stopError);
          await interaction.editReply({
            content: `Error stopping Tailscale: ${stopError.message}`,
            components: [],
          });
        }
        return true;
      }

      // Cancel stop Tailscale
      else if (customId === "cancel_tailscale_stop") {
        try {
          await interaction.editReply({
            content: "Cancelled. Tailscale service will continue running.",
            components: [],
            embeds: [],
          });
        } catch (cancelError) {
          console.error("[handleInteraction] Cancel error:", cancelError);
        }
        return true;
      }

      // Confirm start Tailscale
      else if (customId === "confirm_tailscale_start") {
        try {
          const result = await tailscaleMonitor.startTailscale();
          const embed = embedBuilder.createTailscaleOperationEmbed(
            result,
            "start"
          );

          // Create status button
          const statusButton = new ButtonBuilder()
            .setCustomId("tailscale_status")
            .setLabel("View Status")
            .setStyle(ButtonStyle.Primary);

          const row = new ActionRowBuilder().addComponents(statusButton);

          await interaction.editReply({
            embeds: [embed],
            components: [row],
            content: null,
          });
        } catch (startError) {
          console.error("[handleInteraction] Start error:", startError);
          await interaction.editReply({
            content: `Error starting Tailscale: ${startError.message}`,
            components: [],
          });
        }
        return true;
      }

      // Not handled by this command
      return false;
    } catch (error) {
      console.error("Error handling Tailscale interaction:", error);
      try {
        await interaction.editReply({
          content: `An error occurred: ${error.message}`,
          components: [],
        });
      } catch (replyError) {
        console.error("Error sending error message:", replyError);
      }
      return true;
    }
  },
};

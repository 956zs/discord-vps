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
        console.log(
          "[autocomplete] Starting autocomplete for hostname:",
          focusedOption.value
        );

        // 先嘗試使用專用 API 獲取 exit nodes 列表
        const exitNodesList = await tailscaleMonitor.getExitNodesList();
        console.log(
          `[autocomplete] 專用 API 返回了 ${exitNodesList.length} 個 exit nodes`
        );

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

          console.log(
            `[autocomplete] 從專用 API 返回 ${filtered.length} 個過濾後的 exit nodes`
          );
          await interaction.respond(filtered);
          return;
        }

        // 如果專用 API 未返回任何結果，使用常規方法
        console.log("[autocomplete] 專用 API 未返回結果，使用常規方法");

        // Get all available nodes
        const status = await tailscaleMonitor.getStatus();

        if (!status.success) {
          console.error("[autocomplete] Tailscale status error:", status.error);
          await interaction.respond([
            { name: "Error: Could not fetch Tailscale nodes", value: "error" },
          ]);
          return;
        }

        // 記錄狀態
        console.log(`[autocomplete] 獲取到 ${status.peers.length} 個 peers`);

        // Filter nodes that can be exit nodes and are online
        const exitNodes = status.peers
          .filter((peer) => peer.exitNode && peer.online)
          .map((peer) => ({
            name: `${peer.hostname} (${peer.exitNodeType || "exit node"})`,
            value: peer.hostname,
          }));

        console.log(
          `[autocomplete] 找到 ${exitNodes.length} 個符合條件的 exit nodes`
        );
        exitNodes.forEach((node) => {
          console.log(`- Exit node: ${node.name}`);
        });

        // 如果沒有找到 exit nodes，檢查原因並給出特定訊息
        if (exitNodes.length === 0) {
          console.log("[autocomplete] 未找到符合條件的 exit nodes，檢查原因");

          // 為所有 peers 添加使用者友好的顯示
          status.peers.forEach((peer) => {
            console.log(
              `[autocomplete] ${peer.hostname}: exitNode=${
                peer.exitNode
              }, online=${peer.online}, type=${peer.exitNodeType || "none"}`
            );
          });

          // 檢查是否有任何 peers 是 exit node（不考慮在線狀態）
          const anyExitNodes = status.peers.filter((peer) => peer.exitNode);
          if (anyExitNodes.length > 0) {
            console.log(
              `[autocomplete] 找到 ${anyExitNodes.length} 個 exit nodes，但它們離線`
            );
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

              console.log(
                `[autocomplete] 提供 ${options.length} 個在線的 peers 作為可能的選項`
              );
              await interaction.respond([
                {
                  name: "No detected exit nodes, but you can try these online peers:",
                  value: "try_online",
                },
                ...options,
              ]);
              return;
            }

            console.log(
              `[autocomplete] 找到 ${status.peers.length} 個 peers，但沒有檢測到 exit node 功能`
            );
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

        console.log(
          `[autocomplete] 返回 ${filtered.length} 個過濾後的 exit nodes`
        );
        await interaction.respond(filtered);
      } catch (error) {
        console.error("[autocomplete] Error in autocomplete:", error);
        await interaction.respond([
          {
            name: "Error occurred: " + error.message.substring(0, 80),
            value: "error",
          },
        ]);
      }
    }
  },

  async execute(interaction) {
    await interaction.deferReply();

    const subcommand = interaction.options.getSubcommand();

    try {
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
      console.error(
        `Error executing Tailscale command (${subcommand}):`,
        error
      );
      await interaction.editReply({
        content: `An error occurred while executing the command: ${error.message}`,
      });
    }
  },

  async handleStatus(interaction) {
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
  },

  async handleNetwork(interaction) {
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
  },

  async handleExitNode(interaction) {
    const action = interaction.options.getString("action");
    const hostname = interaction.options.getString("hostname");

    try {
      if (action === "off") {
        const result = await tailscaleMonitor.disableExitNode();
        if (result.success) {
          const embed = embedBuilder.buildExitNodeEmbed("disabled");
          await interaction.editReply({ embeds: [embed] });
        } else {
          await interaction.editReply({
            content: "Failed to disable exit node. Please try again later.",
            ephemeral: true,
          });
        }
      } else if (action === "on") {
        if (!hostname) {
          await interaction.editReply({
            content: "Please provide a hostname to enable the exit node.",
            ephemeral: true,
          });
          return;
        }
        const result = await tailscaleMonitor.enableExitNode(hostname);
        if (result.success) {
          const embed = embedBuilder.buildExitNodeEmbed("enabled", hostname);
          await interaction.editReply({ embeds: [embed] });
        } else {
          await interaction.editReply({
            content: "Failed to enable exit node. Please try again later.",
            ephemeral: true,
          });
        }
      }
    } catch (error) {
      console.error("Error handling exit node:", error);
      // Check if the interaction has already been replied to
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "An error occurred while handling the exit node request.",
          ephemeral: true,
        });
      } else {
        await interaction.editReply({
          content: "An error occurred while handling the exit node request.",
          ephemeral: true,
        });
      }
    }
  },

  async handleStart(interaction) {
    const result = await tailscaleMonitor.startTailscale();
    const embed = embedBuilder.createTailscaleOperationEmbed(result, "start");

    // Create buttons
    const statusButton = new ButtonBuilder()
      .setCustomId("tailscale_status")
      .setLabel("View Status")
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(statusButton);

    await interaction.editReply({ embeds: [embed], components: [row] });
  },

  async handleStop(interaction) {
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
        return true;
      }

      // Refresh Tailscale network stats button
      else if (
        customId === "refresh_tailscale_network" ||
        customId === "tailscale_network_stats"
      ) {
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
        return true;
      }

      // Confirm stop Tailscale
      else if (customId === "confirm_tailscale_stop") {
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
        return true;
      }

      // Cancel stop Tailscale
      else if (customId === "cancel_tailscale_stop") {
        await interaction.editReply({
          content: "Cancelled. Tailscale service will continue running.",
          components: [],
          embeds: [],
        });
        return true;
      }

      // Confirm start Tailscale
      else if (customId === "confirm_tailscale_start") {
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

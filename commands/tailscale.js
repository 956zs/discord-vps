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
        // Get all available nodes
        const status = await tailscaleMonitor.getStatus();

        if (!status.success) {
          console.error("Tailscale status error:", status.error);
          await interaction.respond([
            { name: "Error: Could not fetch Tailscale nodes", value: "error" },
          ]);
          return;
        }

        // 記錄有幾個 peers
        console.log(
          `Autocomplete: Found ${status.peers.length} Tailscale peers`
        );

        // Filter nodes that can be exit nodes and are online
        const exitNodes = status.peers
          .filter((peer) => peer.exitNode && peer.online)
          .map((peer) => ({ name: peer.hostname, value: peer.hostname }));

        console.log(
          `Autocomplete: Found ${exitNodes.length} eligible exit nodes`
        );

        // 打印所有可用的 exit nodes
        exitNodes.forEach((node) => {
          console.log(`- Exit node option: ${node.name}`);
        });

        if (exitNodes.length === 0) {
          console.log("No eligible exit nodes found for autocomplete");

          // 檢查是否有任何 peers 是 exit node
          const anyExitNodes = status.peers.filter((peer) => peer.exitNode);
          if (anyExitNodes.length > 0) {
            console.log(
              `Found ${anyExitNodes.length} exit nodes, but they are offline`
            );
            await interaction.respond([
              {
                name: "Found exit nodes but they are offline",
                value: "offline",
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
          `Autocomplete: Returning ${filtered.length} filtered exit nodes`
        );
        await interaction.respond(filtered);
      } catch (error) {
        console.error("Error in autocomplete:", error);
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

    // For 'on' action, we need a hostname
    if (action === "on") {
      const hostname = interaction.options.getString("hostname");

      if (!hostname) {
        // 獲取所有可用的 exit nodes 並顯示給用戶
        const status = await tailscaleMonitor.getStatus();

        if (!status.success) {
          await interaction.editReply({
            content: `Unable to get Tailscale status: ${status.error}`,
          });
          return;
        }

        const eligibleExitNodes = status.peers.filter(
          (p) => p.exitNode && p.online
        );

        if (eligibleExitNodes.length === 0) {
          await interaction.editReply({
            content:
              "You must specify a valid hostname when enabling an exit node, but no eligible exit nodes were found. Ensure that some machines have exit node capability enabled in Tailscale admin.",
          });
          return;
        }

        // 顯示可用的 exit nodes 給用戶
        const availableNodes = eligibleExitNodes
          .map((p) => `- ${p.hostname} (${p.ip})`)
          .join("\n");

        await interaction.editReply({
          content: `You must specify a valid hostname when enabling an exit node. Available exit nodes:\n\n${availableNodes}\n\nTry again with: \`/tailscale exit-node on <hostname>\``,
        });
        return;
      }

      if (
        hostname === "error" ||
        hostname === "none" ||
        hostname === "offline"
      ) {
        const messageMap = {
          error:
            "There was an error retrieving exit nodes. Please check the server logs.",
          none: "No eligible exit nodes were found. Ensure that some machines have exit node capability enabled in Tailscale admin.",
          offline:
            "Found exit nodes but they are currently offline. Please wait for them to come online.",
        };

        await interaction.editReply({
          content: messageMap[hostname] || "Invalid hostname selection.",
        });
        return;
      }

      const result = await tailscaleMonitor.enableExitNode(hostname);
      const embed = embedBuilder.createTailscaleOperationEmbed(
        result,
        "enable-exit-node"
      );

      // Create buttons
      const statusButton = new ButtonBuilder()
        .setCustomId("tailscale_status")
        .setLabel("View Status")
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(statusButton);

      await interaction.editReply({ embeds: [embed], components: [row] });
    }
    // For 'off' action, we disable the exit node
    else if (action === "off") {
      const result = await tailscaleMonitor.disableExitNode();
      const embed = embedBuilder.createTailscaleOperationEmbed(
        result,
        "disable-exit-node"
      );

      // Create buttons
      const statusButton = new ButtonBuilder()
        .setCustomId("tailscale_status")
        .setLabel("View Status")
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(statusButton);

      await interaction.editReply({ embeds: [embed], components: [row] });
    } else {
      await interaction.editReply({ content: "Invalid action specified." });
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

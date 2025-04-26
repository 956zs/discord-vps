const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require("discord.js");
const dockerMonitor = require("../utils/dockerMonitor");
const embedBuilder = require("../utils/embedBuilder");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("docker")
    .setDescription("Monitor and manage Docker containers")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("info")
        .setDescription("Show Docker system information")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("containers")
        .setDescription("List all Docker containers")
        .addBooleanOption((option) =>
          option
            .setName("all")
            .setDescription("Show all containers (including stopped ones)")
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("details")
        .setDescription("Show detailed information about a container")
        .addStringOption((option) =>
          option
            .setName("container")
            .setDescription("Container ID or name")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("logs")
        .setDescription("Show logs from a container")
        .addStringOption((option) =>
          option
            .setName("container")
            .setDescription("Container ID or name")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addIntegerOption((option) =>
          option
            .setName("lines")
            .setDescription("Number of log lines to show")
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("control")
        .setDescription("Control a container (start, stop, restart)")
        .addStringOption((option) =>
          option
            .setName("container")
            .setDescription("Container ID or name")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((option) =>
          option
            .setName("action")
            .setDescription("Action to perform")
            .setRequired(true)
            .addChoices(
              { name: "Start", value: "start" },
              { name: "Stop", value: "stop" },
              { name: "Restart", value: "restart" }
            )
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === "info") {
        const dockerInfo = await dockerMonitor.getDockerInfo();
        const embed = embedBuilder.createDockerInfoEmbed(dockerInfo);

        const refreshButton = new ButtonBuilder()
          .setCustomId("refresh_docker_info")
          .setLabel("Refresh")
          .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(refreshButton);

        await interaction.editReply({ embeds: [embed], components: [row] });
      } else if (subcommand === "containers") {
        const showAll = interaction.options.getBoolean("all") ?? true;
        const containers = await dockerMonitor.listContainers(showAll);
        const embed = embedBuilder.createContainerListEmbed(containers);

        const refreshButton = new ButtonBuilder()
          .setCustomId("refresh_containers")
          .setLabel("Refresh")
          .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(refreshButton);

        await interaction.editReply({ embeds: [embed], components: [row] });
      } else if (subcommand === "details") {
        const containerId = interaction.options.getString("container");
        const containerInfo = await dockerMonitor.getContainerInfo(containerId);
        const embed = embedBuilder.createContainerDetailsEmbed(containerInfo);

        // Create action buttons for the container
        const startButton = new ButtonBuilder()
          .setCustomId(`container_start_${containerInfo.id}`)
          .setLabel("Start")
          .setStyle(ButtonStyle.Success)
          .setDisabled(containerInfo.state.running);

        const stopButton = new ButtonBuilder()
          .setCustomId(`container_stop_${containerInfo.id}`)
          .setLabel("Stop")
          .setStyle(ButtonStyle.Danger)
          .setDisabled(!containerInfo.state.running);

        const restartButton = new ButtonBuilder()
          .setCustomId(`container_restart_${containerInfo.id}`)
          .setLabel("Restart")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(!containerInfo.state.running);

        const logsButton = new ButtonBuilder()
          .setCustomId(`container_logs_${containerInfo.id}`)
          .setLabel("Logs")
          .setStyle(ButtonStyle.Secondary);

        const refreshButton = new ButtonBuilder()
          .setCustomId(`refresh_container_${containerInfo.id}`)
          .setLabel("Refresh")
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(
          startButton,
          stopButton,
          restartButton,
          logsButton,
          refreshButton
        );

        await interaction.editReply({ embeds: [embed], components: [row] });
      } else if (subcommand === "logs") {
        const containerId = interaction.options.getString("container");
        const lines = interaction.options.getInteger("lines") || 100;

        // First get container info to get the name
        const containerInfo = await dockerMonitor.getContainerInfo(containerId);
        const logs = await dockerMonitor.getContainerLogs(containerId, lines);

        const embed = embedBuilder.createContainerLogsEmbed(
          containerInfo.id,
          containerInfo.name,
          logs
        );

        const refreshButton = new ButtonBuilder()
          .setCustomId(`refresh_logs_${containerInfo.id}`)
          .setLabel("Refresh")
          .setStyle(ButtonStyle.Primary);

        const detailsButton = new ButtonBuilder()
          .setCustomId(`container_details_${containerInfo.id}`)
          .setLabel("Details")
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(
          refreshButton,
          detailsButton
        );

        await interaction.editReply({ embeds: [embed], components: [row] });
      } else if (subcommand === "control") {
        const containerId = interaction.options.getString("container");
        const action = interaction.options.getString("action");

        const result = await dockerMonitor.controlContainer(
          containerId,
          action
        );

        await interaction.editReply({
          content: `Successfully ${action}ed container \`${result.name}\` (${result.id}). Current status: ${result.status}`,
          components: [],
        });
      }
    } catch (error) {
      console.error("Error in docker command:", error);
      await interaction.editReply({
        content: "There was an error with the Docker operation.",
      });
    }
  },

  // For handling autocomplete
  async autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);

    if (focusedOption.name === "container") {
      try {
        const containers = await dockerMonitor.listContainers(true);
        const filtered = containers.filter((container) => {
          const search = focusedOption.value.toLowerCase();

          // Check if container name or ID matches the search
          return (
            container.names.some((name) =>
              name.toLowerCase().includes(search)
            ) || container.id.toLowerCase().includes(search)
          );
        });

        // Return choices in the format needed for autocomplete
        const choices = filtered
          .map((container) => ({
            name: `${container.names[0] || container.id} (${container.state})`,
            value: container.names[0] || container.id,
          }))
          .slice(0, 25); // Limit to 25 choices

        await interaction.respond(choices);
      } catch (error) {
        console.error("Error in docker autocomplete:", error);
        await interaction.respond([]);
      }
    }
  },
};

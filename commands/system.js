const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const systemMonitor = require("../utils/systemMonitor");
const embedBuilder = require("../utils/embedBuilder");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("system")
    .setDescription("Display system information about the VPS")
    .addSubcommand((subcommand) =>
      subcommand.setName("info").setDescription("Show basic system information")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("network").setDescription("Show network information")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("processes").setDescription("Show running processes")
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === "info") {
        const systemInfo = await systemMonitor.getSystemInfo();
        const embed = embedBuilder.createSystemInfoEmbed(systemInfo);

        const refreshButton = new ButtonBuilder()
          .setCustomId("refresh_system_info")
          .setLabel("Refresh")
          .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(refreshButton);

        await interaction.editReply({ embeds: [embed], components: [row] });
      } else if (subcommand === "network") {
        const networkInfo = await systemMonitor.getNetworkInfo();
        const embed = embedBuilder.createNetworkInfoEmbed(networkInfo);

        const refreshButton = new ButtonBuilder()
          .setCustomId("refresh_network_info")
          .setLabel("Refresh")
          .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(refreshButton);

        await interaction.editReply({ embeds: [embed], components: [row] });
      } else if (subcommand === "processes") {
        const processes = await systemMonitor.getProcessInfo();
        const embed = embedBuilder.createProcessListEmbed(processes);

        const refreshButton = new ButtonBuilder()
          .setCustomId("refresh_processes")
          .setLabel("Refresh")
          .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(refreshButton);

        await interaction.editReply({ embeds: [embed], components: [row] });
      }
    } catch (error) {
      console.error("Error in system command:", error);
      await interaction.editReply({
        content: "There was an error fetching system information.",
      });
    }
  },
};

/*
 * firewall.js - 系統防火牆監控與管理命令
 *
 * 此文件包含Discord斜線命令 "/firewall" 的所有功能，允許用戶:
 * 1. 查看系統防火牆狀態 (/firewall status)
 * 2. 封鎖特定IP地址 (/firewall block)
 * 3. 解除封鎖IP地址 (/firewall unblock)
 *
 * 主要特色功能:
 * - 互動按鈕: 每個命令回應都包含互動按鈕，如刷新等
 * - 子命令結構: 使用Discord.js的子命令結構，將不同功能組織在一個主命令下
 * - 防火牆規則統計: 顯示各種過濾規則的統計資訊
 * - 支援多種防火牆系統: 支援iptables，並選擇性支援ufw和firewalld
 */

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");
const firewallMonitor = require("../utils/firewallMonitor");
const embedBuilder = require("../utils/embedBuilder");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("firewall")
    .setDescription("Monitor and manage system firewall")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("status")
        .setDescription("Display current firewall status and rules")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("block")
        .setDescription("Block an IP address")
        .addStringOption((option) =>
          option
            .setName("ip")
            .setDescription("IP address to block (IPv4 or IPv6)")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("unblock")
        .setDescription("Unblock a previously blocked IP address")
        .addStringOption((option) =>
          option
            .setName("ip")
            .setDescription("IP address to unblock (IPv4 or IPv6)")
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === "status") {
        // Get firewall status
        const firewallData = await firewallMonitor.getFirewallStatus();
        const embed = embedBuilder.createFirewallStatusEmbed(firewallData);

        // Create refresh button
        const refreshButton = new ButtonBuilder()
          .setCustomId("refresh_firewall_status")
          .setLabel("Refresh")
          .setStyle(ButtonStyle.Primary);

        // Add a "Show Detailed Rules" button
        const detailedRulesButton = new ButtonBuilder()
          .setCustomId("firewall_detailed_rules")
          .setLabel("🔍 Show Detailed Rules")
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(
          refreshButton,
          detailedRulesButton
        );

        await interaction.editReply({ embeds: [embed], components: [row] });
      } else if (subcommand === "block") {
        const ipAddress = interaction.options.getString("ip");

        // Ask for confirmation before blocking
        const confirmButton = new ButtonBuilder()
          .setCustomId(`confirm_firewall_block_${ipAddress}`)
          .setLabel("Confirm Block")
          .setStyle(ButtonStyle.Danger);

        const cancelButton = new ButtonBuilder()
          .setCustomId("cancel_firewall_block")
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(
          confirmButton,
          cancelButton
        );

        await interaction.editReply({
          content: `Are you sure you want to block IP address \`${ipAddress}\`? This will prevent all traffic from this IP.`,
          components: [row],
        });
      } else if (subcommand === "unblock") {
        const ipAddress = interaction.options.getString("ip");

        // Ask for confirmation before unblocking
        const confirmButton = new ButtonBuilder()
          .setCustomId(`confirm_firewall_unblock_${ipAddress}`)
          .setLabel("Confirm Unblock")
          .setStyle(ButtonStyle.Success);

        const cancelButton = new ButtonBuilder()
          .setCustomId("cancel_firewall_operation")
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(
          confirmButton,
          cancelButton
        );

        await interaction.editReply({
          content: `Are you sure you want to unblock IP address \`${ipAddress}\`?`,
          components: [row],
        });
      }
    } catch (error) {
      console.error("Error in firewall command:", error);
      await interaction.editReply({
        content: "There was an error executing this command.",
      });
    }
  },
};

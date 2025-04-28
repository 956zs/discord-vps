/*
 * wg.js - WireGuard VPN管理命令
 *
 * 此文件包含Discord斜線命令 "/wg" 的所有功能，允許用戶:
 * 1. 查看WireGuard接口狀態 (/wg status)
 * 2. 列出指定接口的所有peers (/wg peer-list)
 * 3. 重啟WireGuard接口 (/wg restart)
 * 4. 新增peer配置 (/wg add-peer)
 * 5. 刪除指定peer (/wg remove-peer)
 *
 * 主要特色功能:
 * - 自動完成功能: 在輸入接口名稱時，會顯示下拉選單供選擇
 * - 互動按鈕: 每個命令回應都包含互動按鈕，如刷新等
 * - 子命令結構: 使用Discord.js的子命令結構，將不同功能組織在一個主命令下
 * - Modal表單輸入: 使用Discord的Modal表單實現add-peer的複雜數據輸入
 */

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
} = require("discord.js");
const wireguardMonitor = require("../utils/wireguardMonitor");
const embedBuilder = require("../utils/embedBuilder");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("wg")
    .setDescription("Monitor and manage WireGuard VPN")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("status")
        .setDescription("List active WireGuard interfaces and their status")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("peer-list")
        .setDescription("List all peers for a specific WireGuard interface")
        .addStringOption((option) =>
          option
            .setName("interface")
            .setDescription("WireGuard interface name (e.g., wg0)")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("restart")
        .setDescription("Restart a WireGuard interface")
        .addStringOption((option) =>
          option
            .setName("interface")
            .setDescription("WireGuard interface name (e.g., wg0)")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add-peer")
        .setDescription("Add a new peer to a WireGuard interface")
        .addStringOption((option) =>
          option
            .setName("interface")
            .setDescription("WireGuard interface name (e.g., wg0)")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove-peer")
        .setDescription("Remove a peer from a WireGuard interface")
        .addStringOption((option) =>
          option
            .setName("interface")
            .setDescription("WireGuard interface name (e.g., wg0)")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((option) =>
          option
            .setName("publickey")
            .setDescription("Public key of the peer to remove")
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    try {
      // Special handling for add-peer to avoid interaction issues
      if (subcommand === "add-peer") {
        const interfaceName = interaction.options.getString("interface");

        // First check if the interface exists
        const interfacesData = await wireguardMonitor.listInterfaces();

        if (!interfacesData.success) {
          await interaction.reply({
            content: `Error checking WireGuard interfaces: ${interfacesData.error}`,
            ephemeral: true,
          });
          return;
        }

        const interfaceExists = interfacesData.interfaces.some(
          (i) => i.name === interfaceName
        );

        if (!interfaceExists) {
          await interaction.reply({
            content: `Interface ${interfaceName} not found.`,
            ephemeral: true,
          });
          return;
        }

        // Create and show modal for peer information
        const modal = new ModalBuilder()
          .setCustomId(`wg_add_peer_modal_${interfaceName}`)
          .setTitle(`Add Peer to ${interfaceName}`);

        // Peer name input
        const nameInput = new TextInputBuilder()
          .setCustomId("peer_name")
          .setLabel("Peer Name (optional)")
          .setPlaceholder("e.g., User1 Phone")
          .setRequired(false)
          .setStyle(TextInputStyle.Short);

        // Public key input
        const publicKeyInput = new TextInputBuilder()
          .setCustomId("public_key")
          .setLabel("Public Key")
          .setPlaceholder("e.g., abc123DEF456ghi789JKL...")
          .setRequired(true)
          .setStyle(TextInputStyle.Paragraph);

        // Allowed IPs input
        const allowedIPsInput = new TextInputBuilder()
          .setCustomId("allowed_ips")
          .setLabel("Allowed IPs")
          .setPlaceholder("e.g., 10.0.0.2/32, 192.168.1.0/24")
          .setRequired(true)
          .setStyle(TextInputStyle.Short);

        // Endpoint input (optional)
        const endpointInput = new TextInputBuilder()
          .setCustomId("endpoint")
          .setLabel("Endpoint (optional)")
          .setPlaceholder("e.g., user.example.com:51820")
          .setRequired(false)
          .setStyle(TextInputStyle.Short);

        // Add inputs to the modal
        const nameRow = new ActionRowBuilder().addComponents(nameInput);
        const publicKeyRow = new ActionRowBuilder().addComponents(
          publicKeyInput
        );
        const allowedIPsRow = new ActionRowBuilder().addComponents(
          allowedIPsInput
        );
        const endpointRow = new ActionRowBuilder().addComponents(endpointInput);

        modal.addComponents(nameRow, publicKeyRow, allowedIPsRow, endpointRow);

        // Show the modal without deferring the reply first
        await interaction.showModal(modal);
        return;
      }

      // For all other commands, defer the reply first
      await interaction.deferReply();

      // Handle different subcommands
      if (subcommand === "status") {
        // Get WireGuard interfaces status
        const interfacesData = await wireguardMonitor.listInterfaces();
        const embed =
          embedBuilder.createWireGuardInterfacesEmbed(interfacesData);

        // Create refresh button
        const refreshButton = new ButtonBuilder()
          .setCustomId("refresh_wg_interfaces")
          .setLabel("Refresh")
          .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(refreshButton);

        await interaction.editReply({ embeds: [embed], components: [row] });
      } else if (subcommand === "peer-list") {
        const interfaceName = interaction.options.getString("interface");

        // Get peers for the specified interface
        const peerData = await wireguardMonitor.getPeers(interfaceName);
        const embed = embedBuilder.createWireGuardPeersEmbed(peerData);

        // Create refresh button
        const refreshButton = new ButtonBuilder()
          .setCustomId(`refresh_wg_peers_${interfaceName}`)
          .setLabel("Refresh")
          .setStyle(ButtonStyle.Primary);

        // Create back to interfaces button
        const backButton = new ButtonBuilder()
          .setCustomId("wg_interfaces")
          .setLabel("Back to Interfaces")
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(
          refreshButton,
          backButton
        );

        await interaction.editReply({ embeds: [embed], components: [row] });
      } else if (subcommand === "restart") {
        const interfaceName = interaction.options.getString("interface");

        // First check if the interface exists
        const interfacesData = await wireguardMonitor.listInterfaces();

        if (!interfacesData.success) {
          await interaction.editReply({
            content: `Error checking WireGuard interfaces: ${interfacesData.error}`,
          });
          return;
        }

        const interfaceExists = interfacesData.interfaces.some(
          (i) => i.name === interfaceName
        );

        if (!interfaceExists) {
          await interaction.editReply({
            content: `Interface ${interfaceName} not found.`,
          });
          return;
        }

        // Ask for confirmation before restarting
        const confirmButton = new ButtonBuilder()
          .setCustomId(`confirm_wg_restart_${interfaceName}`)
          .setLabel("Confirm Restart")
          .setStyle(ButtonStyle.Danger);

        const cancelButton = new ButtonBuilder()
          .setCustomId(`cancel_wg_restart_${interfaceName}`)
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(
          confirmButton,
          cancelButton
        );

        await interaction.editReply({
          content: `Are you sure you want to restart WireGuard interface \`${interfaceName}\`? This may disrupt active VPN connections.`,
          components: [row],
        });
      } else if (subcommand === "remove-peer") {
        const interfaceName = interaction.options.getString("interface");
        const publicKey = interaction.options.getString("publickey");

        // Ask for confirmation before removing
        const confirmButton = new ButtonBuilder()
          .setCustomId(`confirm_wg_remove_peer_${interfaceName}_${publicKey}`)
          .setLabel("Confirm Remove")
          .setStyle(ButtonStyle.Danger);

        const cancelButton = new ButtonBuilder()
          .setCustomId(`cancel_wg_remove_peer`)
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(
          confirmButton,
          cancelButton
        );

        await interaction.editReply({
          content: `Are you sure you want to remove the peer with public key \`${publicKey}\` from WireGuard interface \`${interfaceName}\`?`,
          components: [row],
        });
      }
    } catch (error) {
      console.error("Error in WireGuard command:", error);
      // Only attempt to reply if we haven't already shown a modal
      if (subcommand !== "add-peer") {
        try {
          await interaction.editReply({
            content: "There was an error executing this command.",
          });
        } catch (replyError) {
          console.error("Error sending error message:", replyError);
        }
      }
    }
  },

  async autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);
    const subcommand = interaction.options.getSubcommand();

    try {
      // For interface name autocompletion
      if (focusedOption.name === "interface") {
        const interfacesData = await wireguardMonitor.listInterfaces();

        if (!interfacesData.success || !interfacesData.interfaces) {
          await interaction.respond([]);
          return;
        }

        const choices = interfacesData.interfaces.map((iface) => ({
          name: iface.name,
          value: iface.name,
        }));

        await interaction.respond(choices);
      }
      // For public key autocompletion in remove-peer
      else if (
        focusedOption.name === "publickey" &&
        subcommand === "remove-peer"
      ) {
        const interfaceName = interaction.options.getString("interface");

        if (!interfaceName) {
          await interaction.respond([
            { name: "Please select an interface first", value: "" },
          ]);
          return;
        }

        const peerData = await wireguardMonitor.getPeers(interfaceName);

        if (!peerData.success || !peerData.peers) {
          await interaction.respond([]);
          return;
        }

        const choices = peerData.peers.map((peer) => {
          // Use peer name if available, otherwise use a shortened public key
          const displayName =
            peer.name || `Peer ${peer.publicKey.substring(0, 8)}...`;
          return {
            name: displayName,
            value: peer.publicKey,
          };
        });

        await interaction.respond(choices);
      }
    } catch (error) {
      console.error("Error in WireGuard autocomplete:", error);
      await interaction.respond([]);
    }
  },
};

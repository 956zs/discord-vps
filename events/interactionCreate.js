const systemMonitor = require("../utils/systemMonitor");
const dockerMonitor = require("../utils/dockerMonitor");
const embedBuilder = require("../utils/embedBuilder");
const {
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
} = require("discord.js");

module.exports = {
  name: "interactionCreate",
  async execute(interaction, client) {
    /**
     * 安全地處理交互，避免 10062 錯誤
     * @param {Function} action - 要執行的交互操作函數
     * @returns {Promise<boolean>} - 操作是否成功
     */
    async function safeInteractionHandle(action) {
      try {
        await action();
        return true;
      } catch (error) {
        if (error.code === 10062) {
          console.log(`交互已過期（錯誤代碼：10062）- 這通常不是問題`);
          return false;
        } else {
          console.error(`處理交互時出錯:`, error);
          return false;
        }
      }
    }

    // Helper function to safely handle interaction responses
    async function safeInteractionReply(
      interaction,
      responseFunction,
      ...args
    ) {
      try {
        return await responseFunction.apply(interaction, args);
      } catch (error) {
        if (error.code === 10062) {
          console.log(`Interaction ${interaction.id} expired (10062)`);
          return false;
        } else {
          console.error(`Error responding to interaction:`, error);
          return false;
        }
      }
    }

    // Handle slash commands
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);

      if (!command) {
        console.error(
          `No command matching ${interaction.commandName} was found.`
        );
        return;
      }

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(`Error executing ${interaction.commandName}`);
        console.error(error);

        // Try to respond with error message if hasn't replied already
        if (!interaction.replied && !interaction.deferred) {
          try {
            await interaction.reply({
              content: "There was an error executing this command.",
              ephemeral: true,
            });
          } catch (replyError) {
            console.error("Could not send error reply:", replyError);
          }
        } else if (interaction.deferred) {
          try {
            await interaction.editReply({
              content: "There was an error executing this command.",
            });
          } catch (replyError) {
            console.error("Could not edit reply with error:", replyError);
          }
        }
      }
    }

    // Handle autocomplete
    else if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);

      if (!command || !command.autocomplete) {
        console.error(`No autocomplete for ${interaction.commandName}`);
        return;
      }

      try {
        await command.autocomplete(interaction);
      } catch (error) {
        console.error(
          `Error handling autocomplete for ${interaction.commandName}`
        );
        console.error(error);
      }
    }

    // Handle select menu interactions
    else if (interaction.isStringSelectMenu()) {
      try {
        const customId = interaction.customId;

        // Handle container selection
        if (customId === "container_select") {
          await safeInteractionReply(interaction, interaction.deferUpdate);

          try {
            const containerId = interaction.values[0];
            const containerInfo = await dockerMonitor.getContainerInfo(
              containerId
            );
            const embed =
              embedBuilder.createContainerDetailsEmbed(containerInfo);

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

            const backButton = new ButtonBuilder()
              .setCustomId("docker_containers")
              .setLabel("Back to List")
              .setStyle(ButtonStyle.Secondary);

            const row = new ActionRowBuilder().addComponents(
              startButton,
              stopButton,
              restartButton,
              logsButton,
              backButton
            );

            await interaction.editReply({ embeds: [embed], components: [row] });
          } catch (error) {
            console.error(`Error processing container selection:`, error);
          }
        }
      } catch (error) {
        console.error("Error handling select menu interaction:", error);
      }
    }

    // Handle button interactions
    else if (interaction.isButton()) {
      const customId = interaction.customId;

      // Safely defer the update for all button interactions
      const deferred = await safeInteractionHandle(async () => {
        await interaction.deferUpdate();
      });

      // If we couldn't defer the interaction, it might be expired - just return
      if (!deferred) return;

      // Check if Tailscale command should handle this interaction
      if (
        customId === "refresh_tailscale_status" ||
        customId === "tailscale_status" ||
        customId === "refresh_tailscale_network" ||
        customId === "tailscale_network_stats" ||
        customId === "confirm_tailscale_stop" ||
        customId === "cancel_tailscale_stop" ||
        customId === "confirm_tailscale_start"
      ) {
        const tailscaleCommand = client.commands.get("tailscale");
        if (tailscaleCommand && tailscaleCommand.handleInteraction) {
          const handled = await tailscaleCommand.handleInteraction(interaction);
          if (handled) return;
        }
      }

      // Now proceed with handling the specific button action
      // 檢查命令是否有自己的處理互動方法
      if (
        customId.startsWith("rerun_") ||
        customId.startsWith("end_session_")
      ) {
        const terminalCommand = client.commands.get("terminal");
        if (terminalCommand && terminalCommand.handleInteraction) {
          return await terminalCommand.handleInteraction(interaction);
        }
      }

      // System info refresh button
      if (customId === "refresh_system_info") {
        const systemInfo = await systemMonitor.getSystemInfo();
        const embed = embedBuilder.createSystemInfoEmbed(systemInfo);
        await interaction.editReply({ embeds: [embed] });
      }

      // Network info refresh button
      else if (customId === "refresh_network_info") {
        const networkInfo = await systemMonitor.getNetworkInfo();
        const embed = embedBuilder.createNetworkInfoEmbed(networkInfo);
        await interaction.editReply({ embeds: [embed] });
      }

      // Process list refresh button
      else if (customId === "refresh_processes") {
        const processes = await systemMonitor.getProcessInfo();
        const embed = embedBuilder.createProcessListEmbed(processes);
        await interaction.editReply({ embeds: [embed] });
      }

      // Docker info refresh button
      else if (customId === "refresh_docker_info") {
        const dockerInfo = await dockerMonitor.getDockerInfo();
        const embed = embedBuilder.createDockerInfoEmbed(dockerInfo);

        const refreshButton = new ButtonBuilder()
          .setCustomId("refresh_docker_info")
          .setLabel("Refresh")
          .setStyle(ButtonStyle.Primary);

        const dockerContainers = new ButtonBuilder()
          .setCustomId("docker_containers")
          .setLabel("Docker Containers")
          .setStyle(ButtonStyle.Secondary);

        const dockerImages = new ButtonBuilder()
          .setCustomId("docker_images")
          .setLabel("Docker Images")
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(
          refreshButton,
          dockerContainers,
          dockerImages
        );

        await interaction.editReply({ embeds: [embed], components: [row] });
      }

      // Container list refresh button
      else if (customId === "refresh_containers") {
        const containers = await dockerMonitor.listContainers(true);
        const embed = embedBuilder.createContainerListEmbed(containers);
        await interaction.editReply({ embeds: [embed] });
      }

      // Docker images list refresh button
      else if (customId === "refresh_images") {
        const images = await dockerMonitor.listImages();
        const embed = embedBuilder.createImageListEmbed(images);

        const refreshButton = new ButtonBuilder()
          .setCustomId("refresh_images")
          .setLabel("Refresh")
          .setStyle(ButtonStyle.Primary);

        const pullButton = new ButtonBuilder()
          .setCustomId("show_pull_modal")
          .setLabel("Pull Image")
          .setStyle(ButtonStyle.Success);

        const row = new ActionRowBuilder().addComponents(
          refreshButton,
          pullButton
        );

        await interaction.editReply({ embeds: [embed], components: [row] });
      }

      // Show Docker images list
      else if (customId === "docker_images") {
        const images = await dockerMonitor.listImages();
        const embed = embedBuilder.createImageListEmbed(images);

        const refreshButton = new ButtonBuilder()
          .setCustomId("refresh_images")
          .setLabel("Refresh")
          .setStyle(ButtonStyle.Primary);

        const pullButton = new ButtonBuilder()
          .setCustomId("show_pull_modal")
          .setLabel("Pull Image")
          .setStyle(ButtonStyle.Success);

        const row = new ActionRowBuilder().addComponents(
          refreshButton,
          pullButton
        );

        await interaction.editReply({ embeds: [embed], components: [row] });
      }

      // Show pull image modal/form
      else if (customId === "show_pull_modal") {
        // We can't show an actual modal through a button interaction
        // Instead, suggest the user to use the /docker pull command
        await interaction.reply({
          content:
            "Please use the `/docker pull` command to pull an image. For example: `/docker pull ubuntu:latest`",
          ephemeral: true,
        });
      }

      // Container detail actions
      else if (customId.startsWith("container_")) {
        const [action, containerId] = customId
          .replace("container_", "")
          .split("_");

        if (action === "start" || action === "stop" || action === "restart") {
          // For stop action, show confirmation dialog
          if (action === "stop") {
            const containerInfo = await dockerMonitor.getContainerInfo(
              containerId
            );

            // Create confirmation buttons
            const confirmButton = new ButtonBuilder()
              .setCustomId(`confirm_stop_${containerId}`)
              .setLabel("Confirm Stop")
              .setStyle(ButtonStyle.Danger);

            const cancelButton = new ButtonBuilder()
              .setCustomId(`cancel_stop_${containerId}`)
              .setLabel("Cancel")
              .setStyle(ButtonStyle.Secondary);

            const row = new ActionRowBuilder().addComponents(
              confirmButton,
              cancelButton
            );

            await interaction.editReply({
              content: `Are you sure you want to stop container \`${containerInfo.name}\`? This may cause service interruption.`,
              components: [row],
            });
            return;
          }

          // For restart action, show confirmation dialog
          if (action === "restart") {
            const containerInfo = await dockerMonitor.getContainerInfo(
              containerId
            );

            // Create confirmation buttons
            const confirmButton = new ButtonBuilder()
              .setCustomId(`confirm_restart_${containerId}`)
              .setLabel("Confirm Restart")
              .setStyle(ButtonStyle.Danger);

            const cancelButton = new ButtonBuilder()
              .setCustomId(`cancel_restart_${containerId}`)
              .setLabel("Cancel")
              .setStyle(ButtonStyle.Secondary);

            const row = new ActionRowBuilder().addComponents(
              confirmButton,
              cancelButton
            );

            await interaction.editReply({
              content: `Are you sure you want to restart container \`${containerInfo.name}\`? This may cause service interruption.`,
              components: [row],
            });
            return;
          }

          // For start action, proceed directly
          await dockerMonitor.controlContainer(containerId, action);

          // Refresh the container details
          const containerInfo = await dockerMonitor.getContainerInfo(
            containerId
          );
          const embed = embedBuilder.createContainerDetailsEmbed(containerInfo);

          // Create new buttons with updated states
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

          await interaction.editReply({
            embeds: [embed],
            components: [row],
            content: null,
          });
        } else if (action === "logs") {
          const containerInfo = await dockerMonitor.getContainerInfo(
            containerId
          );
          const logs = await dockerMonitor.getContainerLogs(containerId, 100);

          const embed = embedBuilder.createContainerLogsEmbed(
            containerInfo.id,
            containerInfo.name,
            logs
          );

          await interaction.editReply({ embeds: [embed] });
        } else if (action === "details") {
          const containerInfo = await dockerMonitor.getContainerInfo(
            containerId
          );
          const embed = embedBuilder.createContainerDetailsEmbed(containerInfo);

          await interaction.editReply({ embeds: [embed] });
        }
      }

      // Container refresh button
      else if (customId.startsWith("refresh_container_")) {
        const containerId = customId.replace("refresh_container_", "");
        const containerInfo = await dockerMonitor.getContainerInfo(containerId);
        const embed = embedBuilder.createContainerDetailsEmbed(containerInfo);
        await interaction.editReply({ embeds: [embed] });
      }

      // Container logs refresh button
      else if (customId.startsWith("refresh_logs_")) {
        const containerId = customId.replace("refresh_logs_", "");
        const containerInfo = await dockerMonitor.getContainerInfo(containerId);
        const logs = await dockerMonitor.getContainerLogs(containerId, 100);

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

        const downloadButton = new ButtonBuilder()
          .setCustomId(`download_logs_${containerInfo.id}`)
          .setLabel("Download Full Logs")
          .setStyle(ButtonStyle.Success);

        const row = new ActionRowBuilder().addComponents(
          refreshButton,
          detailsButton,
          downloadButton
        );

        await interaction.editReply({ embeds: [embed], components: [row] });
      }

      // Download full logs button
      else if (customId.startsWith("download_logs_")) {
        const containerId = customId.replace("download_logs_", "");
        const containerInfo = await dockerMonitor.getContainerInfo(containerId);

        try {
          // Get all logs (null parameter)
          const logs = await dockerMonitor.getContainerLogs(containerId, null);

          // Create log file contents with timestamp
          const timestamp = new Date().toISOString().replace(/:/g, "-");
          const fileName = `${containerInfo.name.replace(
            /[^a-zA-Z0-9]/g,
            "_"
          )}_logs_${timestamp}.txt`;

          // Create the embed for notification
          const embed = new EmbedBuilder()
            .setColor("#2496ED") // Docker blue
            .setTitle(`📥 Docker Logs: ${containerInfo.name}`)
            .setDescription(
              `Complete logs for container ${containerInfo.name} are attached.`
            )
            .addFields(
              { name: "Container", value: containerInfo.name, inline: true },
              { name: "ID", value: containerInfo.id, inline: true },
              {
                name: "Status",
                value: containerInfo.state.status,
                inline: true,
              }
            )
            .setTimestamp();

          // Upload the logs as file attachment
          await interaction.editReply({
            embeds: [embed],
            files: [
              {
                attachment: Buffer.from(logs),
                name: fileName,
              },
            ],
            components: [], // Remove buttons for this specific response
          });
        } catch (error) {
          console.error(`Error downloading logs for ${containerId}:`, error);
          await interaction.editReply({
            content: `Error downloading logs: ${error.message}`,
            components: [],
            embeds: [],
          });
        }
      }

      // Docker containers button - shows container list
      else if (customId === "docker_containers") {
        // Get all containers (including stopped ones)
        const containers = await dockerMonitor.listContainers(true);
        const embed = embedBuilder.createContainerListEmbed(containers);

        // Create the refresh button
        const refreshButton = new ButtonBuilder()
          .setCustomId("refresh_containers")
          .setLabel("Refresh")
          .setStyle(ButtonStyle.Primary);

        // Create the Docker Info button to go back
        const dockerInfoButton = new ButtonBuilder()
          .setCustomId("docker_info")
          .setLabel("Docker Info")
          .setStyle(ButtonStyle.Secondary);

        // Create the Docker Images button
        const dockerImagesButton = new ButtonBuilder()
          .setCustomId("docker_images")
          .setLabel("Docker Images")
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(
          refreshButton,
          dockerInfoButton,
          dockerImagesButton
        );

        // Create the select menu for container actions if we have containers
        if (containers.length > 0) {
          // Get up to 25 containers (Discord limit for select menu)
          const menuContainers = containers.slice(0, 25);

          // Create the select menu
          const containerSelect = new StringSelectMenuBuilder()
            .setCustomId("container_select")
            .setPlaceholder("Select a container for details...")
            .addOptions(
              menuContainers.map((container) => ({
                label: container.names[0] || container.id.substring(0, 12),
                description: `${container.image} (${container.state})`,
                value: container.id,
                emoji:
                  container.state === "running"
                    ? "✅"
                    : container.state === "exited"
                    ? "⛔"
                    : "⚠️",
              }))
            );

          const selectRow = new ActionRowBuilder().addComponents(
            containerSelect
          );

          await interaction.editReply({
            embeds: [embed],
            components: [row, selectRow],
          });
        } else {
          await interaction.editReply({
            embeds: [embed],
            components: [row],
          });
        }
      }

      // Docker info button - shows Docker system info
      else if (customId === "docker_info") {
        const dockerInfo = await dockerMonitor.getDockerInfo();
        const embed = embedBuilder.createDockerInfoEmbed(dockerInfo);

        const refreshButton = new ButtonBuilder()
          .setCustomId("refresh_docker_info")
          .setLabel("Refresh")
          .setStyle(ButtonStyle.Primary);

        const dockerContainers = new ButtonBuilder()
          .setCustomId("docker_containers")
          .setLabel("Docker Containers")
          .setStyle(ButtonStyle.Secondary);

        const dockerImages = new ButtonBuilder()
          .setCustomId("docker_images")
          .setLabel("Docker Images")
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(
          refreshButton,
          dockerContainers,
          dockerImages
        );

        await interaction.editReply({ embeds: [embed], components: [row] });
      }

      // Handle stop confirmation
      else if (customId.startsWith("confirm_stop_")) {
        const containerId = customId.replace("confirm_stop_", "");

        try {
          // Stop the container
          await dockerMonitor.controlContainer(containerId, "stop");

          // Get updated container info
          const containerInfo = await dockerMonitor.getContainerInfo(
            containerId
          );
          const embed = embedBuilder.createContainerDetailsEmbed(containerInfo);

          // Create new buttons with updated states
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

          // Reply with success message and updated container details
          await interaction.editReply({
            content: `Container \`${containerInfo.name}\` successfully stopped.`,
            embeds: [embed],
            components: [row],
          });
        } catch (error) {
          console.error(`Error stopping container ${containerId}:`, error);
          await interaction.editReply({
            content: `Error stopping container: ${error.message}`,
            components: [],
            embeds: [],
          });
        }
      }

      // Handle stop cancellation
      else if (customId.startsWith("cancel_stop_")) {
        const containerId = customId.replace("cancel_stop_", "");
        const containerInfo = await dockerMonitor.getContainerInfo(containerId);
        const embed = embedBuilder.createContainerDetailsEmbed(containerInfo);

        // Create new buttons with updated states
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

        // Reply with cancellation message
        await interaction.editReply({
          content: `Stop operation cancelled for container \`${containerInfo.name}\`.`,
          embeds: [embed],
          components: [row],
        });
      }

      // Handle restart confirmation
      else if (customId.startsWith("confirm_restart_")) {
        const containerId = customId.replace("confirm_restart_", "");

        try {
          // Restart the container
          await dockerMonitor.controlContainer(containerId, "restart");

          // Get updated container info
          const containerInfo = await dockerMonitor.getContainerInfo(
            containerId
          );
          const embed = embedBuilder.createContainerDetailsEmbed(containerInfo);

          // Create new buttons with updated states
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

          // Reply with success message and updated container details
          await interaction.editReply({
            content: `Container \`${containerInfo.name}\` successfully restarted.`,
            embeds: [embed],
            components: [row],
          });
        } catch (error) {
          console.error(`Error restarting container ${containerId}:`, error);
          await interaction.editReply({
            content: `Error restarting container: ${error.message}`,
            components: [],
            embeds: [],
          });
        }
      }

      // Handle restart cancellation
      else if (customId.startsWith("cancel_restart_")) {
        const containerId = customId.replace("cancel_restart_", "");
        const containerInfo = await dockerMonitor.getContainerInfo(containerId);
        const embed = embedBuilder.createContainerDetailsEmbed(containerInfo);

        // Create new buttons with updated states
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

        // Reply with cancellation message
        await interaction.editReply({
          content: `Restart operation cancelled for container \`${containerInfo.name}\`.`,
          embeds: [embed],
          components: [row],
        });
      }

      // === Docker Compose 相關按鈕處理 ===
      // 刷新 Compose 專案列表
      else if (customId === "refresh_compose_projects") {
        try {
          const projects = await dockerMonitor.listComposeProjects();
          const embed = embedBuilder.createComposeProjectsListEmbed(projects);

          const refreshButton = new ButtonBuilder()
            .setCustomId("refresh_compose_projects")
            .setLabel("刷新")
            .setStyle(ButtonStyle.Primary);

          const row = new ActionRowBuilder().addComponents(refreshButton);

          await interaction.editReply({ embeds: [embed], components: [row] });
        } catch (error) {
          console.error("Error refreshing compose projects:", error);
          await interaction.editReply({
            content: `刷新 Docker Compose 專案列表時出錯: ${error.message}`,
            embeds: [],
            components: [],
          });
        }
      }

      // 刷新 Compose 專案詳情
      else if (customId.startsWith("refresh_compose_details_")) {
        const projectName = decodeURIComponent(
          customId.replace("refresh_compose_details_", "")
        );

        try {
          const projectDetails = await dockerMonitor.getComposeProjectDetails(
            projectName
          );
          const embed =
            embedBuilder.createComposeProjectDetailsEmbed(projectDetails);

          const upButton = new ButtonBuilder()
            .setCustomId(`compose_up_${encodeURIComponent(projectName)}`)
            .setLabel("啟動")
            .setStyle(ButtonStyle.Success);

          const downButton = new ButtonBuilder()
            .setCustomId(`compose_down_${encodeURIComponent(projectName)}`)
            .setLabel("停止")
            .setStyle(ButtonStyle.Danger);

          const restartButton = new ButtonBuilder()
            .setCustomId(`compose_restart_${encodeURIComponent(projectName)}`)
            .setLabel("重啟")
            .setStyle(ButtonStyle.Primary);

          const pullButton = new ButtonBuilder()
            .setCustomId(`compose_pull_${encodeURIComponent(projectName)}`)
            .setLabel("拉取映像")
            .setStyle(ButtonStyle.Secondary);

          const refreshButton = new ButtonBuilder()
            .setCustomId(
              `refresh_compose_details_${encodeURIComponent(projectName)}`
            )
            .setLabel("刷新")
            .setStyle(ButtonStyle.Secondary);

          const row = new ActionRowBuilder().addComponents(
            upButton,
            downButton,
            restartButton,
            pullButton,
            refreshButton
          );

          await interaction.editReply({ embeds: [embed], components: [row] });
        } catch (error) {
          console.error(
            `Error refreshing compose details for ${projectName}:`,
            error
          );
          await interaction.editReply({
            content: `刷新 Docker Compose 專案詳情時出錯: ${error.message}`,
            embeds: [],
            components: [],
          });
        }
      }

      // 處理 Compose 操作按鈕 (up, down, restart)
      else if (
        customId.startsWith("compose_up_") ||
        customId.startsWith("compose_down_") ||
        customId.startsWith("compose_restart_")
      ) {
        const action = customId.split("_")[1]; // up, down, restart
        const projectName = decodeURIComponent(
          customId.split("_").slice(2).join("_")
        );

        // 進行確認
        const confirmButton = new ButtonBuilder()
          .setCustomId(
            `confirm_compose_${action}_${encodeURIComponent(projectName)}`
          )
          .setLabel(
            `確認${
              action === "up" ? "啟動" : action === "down" ? "停止" : "重啟"
            }`
          )
          .setStyle(ButtonStyle.Danger);

        const cancelButton = new ButtonBuilder()
          .setCustomId(
            `cancel_compose_${action}_${encodeURIComponent(projectName)}`
          )
          .setLabel("取消")
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(
          confirmButton,
          cancelButton
        );

        let warningMessage = "";
        if (action === "up") {
          warningMessage = `您確定要啟動 Docker Compose 專案 \`${projectName}\` 嗎？這將啟動所有相關的容器。`;
        } else if (action === "down") {
          warningMessage = `您確定要停止 Docker Compose 專案 \`${projectName}\` 嗎？這將停止並移除所有相關的容器。`;
        } else if (action === "restart") {
          warningMessage = `您確定要重啟 Docker Compose 專案 \`${projectName}\` 嗎？這將重啟所有相關的容器。`;
        }

        await interaction.editReply({
          content: warningMessage,
          embeds: [],
          components: [row],
        });
      }

      // 處理 Compose pull 按鈕
      else if (customId.startsWith("compose_pull_")) {
        const projectName = decodeURIComponent(
          customId.replace("compose_pull_", "")
        );

        // 發送初始回應
        await interaction.editReply({
          content: `🔄 正在拉取 Docker Compose 專案 \`${projectName}\` 的映像... 這可能需要一些時間，取決於映像大小。`,
          embeds: [],
          components: [],
        });

        try {
          // 執行拉取操作
          const pullResult = await dockerMonitor.pullComposeImages(projectName);

          // 創建嵌入消息
          const embed = embedBuilder.createComposePullResultEmbed(pullResult);

          // 創建按鈕
          const detailsButton = new ButtonBuilder()
            .setCustomId(
              `refresh_compose_details_${encodeURIComponent(projectName)}`
            )
            .setLabel("查看專案詳情")
            .setStyle(ButtonStyle.Primary);

          const restartButton = new ButtonBuilder()
            .setCustomId(`compose_restart_${encodeURIComponent(projectName)}`)
            .setLabel("重啟容器")
            .setStyle(ButtonStyle.Success);

          const row = new ActionRowBuilder().addComponents(
            detailsButton,
            restartButton
          );

          // 更新回應
          await interaction.editReply({
            content: null,
            embeds: [embed],
            components: [row],
          });
        } catch (error) {
          console.error(`Error pulling images for ${projectName}:`, error);

          // 創建錯誤嵌入消息
          const embed = new EmbedBuilder()
            .setColor("#FF0000")
            .setTitle(`Docker Compose Pull 失敗: ${projectName}`)
            .setDescription(
              `❌ 拉取 Docker Compose 專案 \`${projectName}\` 的映像時出錯`
            )
            .addFields({
              name: "錯誤",
              value: error.message || "未知錯誤",
            })
            .setTimestamp();

          await interaction.editReply({
            content: null,
            embeds: [embed],
            components: [],
          });
        }
      }

      // 處理 Compose 操作確認按鈕
      else if (customId.startsWith("confirm_compose_")) {
        const parts = customId.replace("confirm_compose_", "").split("_");
        const action = parts[0]; // up, down, restart
        const projectName = decodeURIComponent(parts.slice(1).join("_"));

        // 發送初始回應
        await interaction.editReply({
          content: `🔄 正在對 Docker Compose 專案 \`${projectName}\` 執行 \`${action}\` 操作... 請稍候。`,
          embeds: [],
          components: [],
        });

        try {
          // 執行操作
          const result = await dockerMonitor.controlComposeProject(
            projectName,
            action
          );

          // 創建嵌入消息
          const embed = embedBuilder.createComposeOperationResultEmbed(result);

          // 創建按鈕
          const detailsButton = new ButtonBuilder()
            .setCustomId(
              `refresh_compose_details_${encodeURIComponent(projectName)}`
            )
            .setLabel("查看專案詳情")
            .setStyle(ButtonStyle.Primary);

          const row = new ActionRowBuilder().addComponents(detailsButton);

          // 更新回應
          await interaction.editReply({
            content: null,
            embeds: [embed],
            components: [row],
          });
        } catch (error) {
          console.error(
            `Error controlling project ${projectName} with action ${action}:`,
            error
          );

          // 創建錯誤嵌入消息
          const embed = new EmbedBuilder()
            .setColor("#FF0000")
            .setTitle(`Docker Compose ${action} 失敗: ${projectName}`)
            .setDescription(
              `❌ 對 Docker Compose 專案 \`${projectName}\` 執行 \`${action}\` 操作時出錯`
            )
            .addFields({
              name: "錯誤",
              value: error.message || "未知錯誤",
            })
            .setTimestamp();

          await interaction.editReply({
            content: null,
            embeds: [embed],
            components: [],
          });
        }
      }

      // 處理 Compose 操作取消按鈕
      else if (customId.startsWith("cancel_compose_")) {
        const parts = customId.replace("cancel_compose_", "").split("_");
        const action = parts[0];
        const projectName = decodeURIComponent(parts.slice(1).join("_"));

        // 返回專案詳情
        try {
          const projectDetails = await dockerMonitor.getComposeProjectDetails(
            projectName
          );
          const embed =
            embedBuilder.createComposeProjectDetailsEmbed(projectDetails);

          const upButton = new ButtonBuilder()
            .setCustomId(`compose_up_${encodeURIComponent(projectName)}`)
            .setLabel("啟動")
            .setStyle(ButtonStyle.Success);

          const downButton = new ButtonBuilder()
            .setCustomId(`compose_down_${encodeURIComponent(projectName)}`)
            .setLabel("停止")
            .setStyle(ButtonStyle.Danger);

          const restartButton = new ButtonBuilder()
            .setCustomId(`compose_restart_${encodeURIComponent(projectName)}`)
            .setLabel("重啟")
            .setStyle(ButtonStyle.Primary);

          const pullButton = new ButtonBuilder()
            .setCustomId(`compose_pull_${encodeURIComponent(projectName)}`)
            .setLabel("拉取映像")
            .setStyle(ButtonStyle.Secondary);

          const refreshButton = new ButtonBuilder()
            .setCustomId(
              `refresh_compose_details_${encodeURIComponent(projectName)}`
            )
            .setLabel("刷新")
            .setStyle(ButtonStyle.Secondary);

          const row = new ActionRowBuilder().addComponents(
            upButton,
            downButton,
            restartButton,
            pullButton,
            refreshButton
          );

          await interaction.editReply({
            content: `已取消${
              action === "up" ? "啟動" : action === "down" ? "停止" : "重啟"
            }操作。`,
            embeds: [embed],
            components: [row],
          });
        } catch (error) {
          console.error(
            `Error returning to compose details for ${projectName}:`,
            error
          );
          await interaction.editReply({
            content: `已取消操作，但獲取專案詳情時出錯: ${error.message}`,
            embeds: [],
            components: [],
          });
        }
      }

      // 處理查找使用特定映像的容器
      else if (customId.startsWith("find_image_containers_")) {
        const imageName = decodeURIComponent(
          customId.replace("find_image_containers_", "")
        );

        // 獲取所有容器
        const containers = await dockerMonitor.listContainers(true);

        // 過濾使用此映像的容器
        const imageContainers = containers.filter(
          (container) =>
            container.image === imageName ||
            container.image.startsWith(`${imageName}@sha256:`)
        );

        if (imageContainers.length > 0) {
          // 創建嵌入訊息顯示容器
          const embed = new EmbedBuilder()
            .setColor("#2496ED") // Docker blue
            .setTitle(`容器使用映像: ${imageName}`)
            .setDescription(`找到 ${imageContainers.length} 個使用此映像的容器`)
            .setTimestamp();

          // 按狀態分組容器
          const running = imageContainers.filter((c) => c.state === "running");
          const stopped = imageContainers.filter((c) => c.state === "exited");
          const others = imageContainers.filter(
            (c) => c.state !== "running" && c.state !== "exited"
          );

          // 添加運行中的容器
          if (running.length > 0) {
            const runningList = running
              .map(
                (c, i) =>
                  `**${i + 1}.** \`${c.names[0] || c.id}\`\n` +
                  `   狀態: ${c.status}\n`
              )
              .join("");

            embed.addFields({
              name: "✅ 運行中的容器",
              value: runningList,
              inline: false,
            });
          }

          // 添加已停止的容器
          if (stopped.length > 0) {
            const stoppedList = stopped
              .map(
                (c, i) =>
                  `**${i + 1}.** \`${c.names[0] || c.id}\`\n` +
                  `   狀態: ${c.status}\n`
              )
              .join("");

            embed.addFields({
              name: "⛔ 已停止的容器",
              value: stoppedList,
              inline: false,
            });
          }

          // 添加其他狀態的容器
          if (others.length > 0) {
            const othersList = others
              .map(
                (c, i) =>
                  `**${i + 1}.** \`${c.names[0] || c.id}\`: ${c.status}\n`
              )
              .join("");

            embed.addFields({
              name: "⚠️ 其他容器",
              value: othersList,
              inline: false,
            });
          }

          // 添加更新這些容器
          embed.addFields({
            name: "更新這些容器",
            value:
              "要更新這些容器使用的映像，請遵循以下步驟：\n" +
              "1. 使用 `/docker control` 停止容器\n" +
              "2. 刪除舊容器 (未來功能)\n" +
              "3. 使用新映像創建新容器 (未來功能)",
            inline: false,
          });

          // 創建選單用於選擇容器
          if (imageContainers.length > 0 && imageContainers.length <= 25) {
            const containerSelect = new StringSelectMenuBuilder()
              .setCustomId("container_select")
              .setPlaceholder("選擇容器查看詳細信息...")
              .addOptions(
                imageContainers.map((container) => ({
                  label: container.names[0] || container.id.substring(0, 12),
                  description: `${container.image.substring(0, 30)}... (${
                    container.state
                  })`,
                  value: container.id,
                  emoji:
                    container.state === "running"
                      ? "✅"
                      : container.state === "exited"
                      ? "⛔"
                      : "⚠️",
                }))
              );

            const selectRow = new ActionRowBuilder().addComponents(
              containerSelect
            );

            // 創建額外按鈕
            const backButton = new ButtonBuilder()
              .setCustomId("docker_images")
              .setLabel("返回映像列表")
              .setStyle(ButtonStyle.Secondary);

            const buttonsRow = new ActionRowBuilder().addComponents(backButton);

            await interaction.editReply({
              content: null,
              embeds: [embed],
              components: [buttonsRow, selectRow],
            });
          } else {
            // 如果容器太多，只顯示返回按鈕
            const backButton = new ButtonBuilder()
              .setCustomId("docker_images")
              .setLabel("返回映像列表")
              .setStyle(ButtonStyle.Secondary);

            const buttonsRow = new ActionRowBuilder().addComponents(backButton);

            await interaction.editReply({
              content: null,
              embeds: [embed],
              components: [buttonsRow],
            });
          }
        } else {
          // 沒有找到使用此映像的容器
          const embed = new EmbedBuilder()
            .setColor("#2496ED")
            .setTitle(`容器使用映像: ${imageName}`)
            .setDescription("未找到使用此映像的容器")
            .setTimestamp();

          const backButton = new ButtonBuilder()
            .setCustomId("docker_images")
            .setLabel("返回映像列表")
            .setStyle(ButtonStyle.Secondary);

          const row = new ActionRowBuilder().addComponents(backButton);

          await interaction.editReply({
            content: null,
            embeds: [embed],
            components: [row],
          });
        }
      }

      // Below is where we'll add our new handlers for WireGuard and firewall

      // WireGuard interfaces refresh button
      else if (customId === "refresh_wg_interfaces") {
        const wireguardMonitor = require("../utils/wireguardMonitor");
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
      }

      // WireGuard peers refresh button
      else if (customId.startsWith("refresh_wg_peers_")) {
        const wireguardMonitor = require("../utils/wireguardMonitor");
        const interfaceName = customId.replace("refresh_wg_peers_", "");

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
      }

      // Go back to WireGuard interfaces list
      else if (customId === "wg_interfaces") {
        const wireguardMonitor = require("../utils/wireguardMonitor");
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
      }

      // Confirm WireGuard interface restart
      else if (customId.startsWith("confirm_wg_restart_")) {
        const wireguardMonitor = require("../utils/wireguardMonitor");
        const interfaceName = customId.replace("confirm_wg_restart_", "");

        // Restart the interface
        await interaction.editReply({
          content: `Restarting WireGuard interface ${interfaceName}...`,
          components: [],
        });

        const result = await wireguardMonitor.restartInterface(interfaceName);
        const embed = embedBuilder.createWireGuardOperationEmbed(
          result,
          "restart"
        );

        // Create buttons
        const refreshButton = new ButtonBuilder()
          .setCustomId("refresh_wg_interfaces")
          .setLabel("View Interfaces")
          .setStyle(ButtonStyle.Primary);

        const peersButton = new ButtonBuilder()
          .setCustomId(`refresh_wg_peers_${interfaceName}`)
          .setLabel("View Peers")
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(
          refreshButton,
          peersButton
        );

        await interaction.editReply({
          embeds: [embed],
          components: [row],
          content: null,
        });
      }

      // Cancel WireGuard interface restart
      else if (customId.startsWith("cancel_wg_restart_")) {
        const interfaceName = customId.replace("cancel_wg_restart_", "");

        await interaction.editReply({
          content: `Restart operation cancelled for WireGuard interface ${interfaceName}.`,
          components: [],
        });
      }

      // Confirm WireGuard peer removal
      else if (customId.startsWith("confirm_wg_remove_peer_")) {
        const wireguardMonitor = require("../utils/wireguardMonitor");
        const params = customId
          .replace("confirm_wg_remove_peer_", "")
          .split("_");

        if (params.length !== 2) {
          await interaction.editReply({
            content: "Invalid operation parameters.",
            components: [],
          });
          return;
        }

        const interfaceName = params[0];
        const publicKey = params[1];

        // Remove the peer
        await interaction.editReply({
          content: `Removing peer from WireGuard interface ${interfaceName}...`,
          components: [],
        });

        const result = await wireguardMonitor.removePeer(
          interfaceName,
          publicKey
        );
        const embed = embedBuilder.createWireGuardOperationEmbed(
          result,
          "remove-peer"
        );

        // Create buttons
        const interfacesButton = new ButtonBuilder()
          .setCustomId("refresh_wg_interfaces")
          .setLabel("View Interfaces")
          .setStyle(ButtonStyle.Primary);

        const peersButton = new ButtonBuilder()
          .setCustomId(`refresh_wg_peers_${interfaceName}`)
          .setLabel("View Peers")
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(
          interfacesButton,
          peersButton
        );

        await interaction.editReply({
          embeds: [embed],
          components: [row],
          content: null,
        });
      }

      // Cancel WireGuard peer removal
      else if (customId === "cancel_wg_remove_peer") {
        await interaction.editReply({
          content: "Peer removal operation cancelled.",
          components: [],
        });
      }

      // Firewall status refresh button
      else if (customId === "refresh_firewall_status") {
        const firewallMonitor = require("../utils/firewallMonitor");
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
      }

      // Firewall detailed rules button
      else if (customId === "firewall_detailed_rules") {
        const firewallMonitor = require("../utils/firewallMonitor");

        // Get the detailed rules
        const detailedRules = await firewallMonitor.getDetailedRules();

        // Create the embed with the rules
        const embed =
          embedBuilder.createDetailedFirewallRulesEmbed(detailedRules);

        // Create a back button
        const backButton = new ButtonBuilder()
          .setCustomId("back_to_firewall_status")
          .setLabel("Back to Summary")
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(backButton);

        // If rules are successful, also create a text file with the full rules
        if (detailedRules.success) {
          // Generate a text file with the complete rules
          const rulesContent = `# iptables-save format\n\n${detailedRules.rules.saveFormat}\n\n# iptables -L -v -n format\n\n${detailedRules.rules.listFormat}`;
          const buffer = Buffer.from(rulesContent, "utf-8");

          const attachment = {
            attachment: buffer,
            name: "firewall-rules.txt",
            description: "Complete firewall rules",
          };

          await interaction.editReply({
            embeds: [embed],
            components: [row],
            files: [attachment],
          });
        } else {
          await interaction.editReply({
            embeds: [embed],
            components: [row],
          });
        }
      }

      // Back to firewall status button
      else if (customId === "back_to_firewall_status") {
        const firewallMonitor = require("../utils/firewallMonitor");
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

        await interaction.editReply({
          embeds: [embed],
          components: [row],
          files: [], // Remove any attached files
        });
      }

      // Confirm firewall IP block
      else if (customId.startsWith("confirm_firewall_block_")) {
        const firewallMonitor = require("../utils/firewallMonitor");
        const ipAddress = customId.replace("confirm_firewall_block_", "");

        // Block the IP
        await interaction.editReply({
          content: `Blocking IP address ${ipAddress}...`,
          components: [],
        });

        const result = await firewallMonitor.blockIP(ipAddress);
        const embed = embedBuilder.createFirewallOperationEmbed(
          result,
          "block"
        );

        // Create buttons
        const statusButton = new ButtonBuilder()
          .setCustomId("refresh_firewall_status")
          .setLabel("View Firewall Status")
          .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(statusButton);

        await interaction.editReply({
          embeds: [embed],
          components: [row],
          content: null,
        });
      }

      // Cancel firewall block operation
      else if (customId === "cancel_firewall_block") {
        await interaction.editReply({
          content: "IP blocking operation cancelled.",
          components: [],
        });
      }

      // Confirm firewall IP unblock
      else if (customId.startsWith("confirm_firewall_unblock_")) {
        const firewallMonitor = require("../utils/firewallMonitor");
        const ipAddress = customId.replace("confirm_firewall_unblock_", "");

        // Unblock the IP
        await interaction.editReply({
          content: `Unblocking IP address ${ipAddress}...`,
          components: [],
        });

        const result = await firewallMonitor.unblockIP(ipAddress);
        const embed = embedBuilder.createFirewallOperationEmbed(
          result,
          "unblock"
        );

        // Create buttons
        const statusButton = new ButtonBuilder()
          .setCustomId("refresh_firewall_status")
          .setLabel("View Firewall Status")
          .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(statusButton);

        await interaction.editReply({
          embeds: [embed],
          components: [row],
          content: null,
        });
      }

      // Cancel firewall operation
      else if (customId === "cancel_firewall_operation") {
        await interaction.editReply({
          content: "Firewall operation cancelled.",
          components: [],
        });
      }
    }

    // Handle modal submissions
    else if (interaction.isModalSubmit()) {
      const modalId = interaction.customId;

      try {
        // Handle WireGuard add peer modal
        if (modalId.startsWith("wg_add_peer_modal_")) {
          const wireguardMonitor = require("../utils/wireguardMonitor");
          const interfaceName = modalId.replace("wg_add_peer_modal_", "");

          // Get values from the modal
          const peerName = interaction.fields.getTextInputValue("peer_name");
          const publicKey = interaction.fields.getTextInputValue("public_key");
          const allowedIPs =
            interaction.fields.getTextInputValue("allowed_ips");
          const endpoint = interaction.fields.getTextInputValue("endpoint");

          // Prepare peer data
          const peerData = {
            name: peerName,
            publicKey: publicKey.trim(),
            allowedIPs: allowedIPs.trim(),
          };

          if (endpoint && endpoint.trim()) {
            peerData.endpoint = endpoint.trim();
          }

          // Add the peer
          await interaction.deferReply();

          const result = await wireguardMonitor.addPeer(
            interfaceName,
            peerData
          );
          const embed = embedBuilder.createWireGuardOperationEmbed(
            result,
            "add-peer"
          );

          // Create buttons
          const interfacesButton = new ButtonBuilder()
            .setCustomId("refresh_wg_interfaces")
            .setLabel("View Interfaces")
            .setStyle(ButtonStyle.Primary);

          const peersButton = new ButtonBuilder()
            .setCustomId(`refresh_wg_peers_${interfaceName}`)
            .setLabel("View Peers")
            .setStyle(ButtonStyle.Secondary);

          const row = new ActionRowBuilder().addComponents(
            interfacesButton,
            peersButton
          );

          await interaction.editReply({ embeds: [embed], components: [row] });
        }

        // Handle other modal submissions here if needed
      } catch (error) {
        console.error("Error processing modal submission:", error);

        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
              content: "There was an error processing your submission.",
              ephemeral: true,
            });
          } else {
            await interaction.editReply({
              content: "There was an error processing your submission.",
            });
          }
        } catch (replyError) {
          console.error("Error sending error message:", replyError);
        }
      }
    }
  },
};

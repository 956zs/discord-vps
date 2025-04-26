const systemMonitor = require("../utils/systemMonitor");
const dockerMonitor = require("../utils/dockerMonitor");
const embedBuilder = require("../utils/embedBuilder");
const {
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");

module.exports = {
  name: "interactionCreate",
  async execute(interaction, client) {
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
          await interaction.deferUpdate();

          const containerId = interaction.values[0];
          const containerInfo = await dockerMonitor.getContainerInfo(
            containerId
          );
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
        }
      } catch (error) {
        console.error("Error handling select menu interaction:", error);
        await interaction.reply({
          content: "There was an error handling this interaction.",
          ephemeral: true,
        });
      }
    }

    // Handle button interactions
    else if (interaction.isButton()) {
      try {
        const customId = interaction.customId;

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
          await interaction.deferUpdate();
          const systemInfo = await systemMonitor.getSystemInfo();
          const embed = embedBuilder.createSystemInfoEmbed(systemInfo);
          await interaction.editReply({ embeds: [embed] });
        }

        // Network info refresh button
        else if (customId === "refresh_network_info") {
          await interaction.deferUpdate();
          const networkInfo = await systemMonitor.getNetworkInfo();
          const embed = embedBuilder.createNetworkInfoEmbed(networkInfo);
          await interaction.editReply({ embeds: [embed] });
        }

        // Process list refresh button
        else if (customId === "refresh_processes") {
          await interaction.deferUpdate();
          const processes = await systemMonitor.getProcessInfo();
          const embed = embedBuilder.createProcessListEmbed(processes);
          await interaction.editReply({ embeds: [embed] });
        }

        // Docker info refresh button
        else if (customId === "refresh_docker_info") {
          await interaction.deferUpdate();
          const dockerInfo = await dockerMonitor.getDockerInfo();
          const embed = embedBuilder.createDockerInfoEmbed(dockerInfo);
          await interaction.editReply({ embeds: [embed] });
        }

        // Container list refresh button
        else if (customId === "refresh_containers") {
          await interaction.deferUpdate();
          const containers = await dockerMonitor.listContainers(true);
          const embed = embedBuilder.createContainerListEmbed(containers);
          await interaction.editReply({ embeds: [embed] });
        }

        // Container detail actions
        else if (customId.startsWith("container_")) {
          const [action, containerId] = customId
            .replace("container_", "")
            .split("_");

          if (action === "start" || action === "stop" || action === "restart") {
            await interaction.deferUpdate();
            await dockerMonitor.controlContainer(containerId, action);

            // Refresh the container details
            const containerInfo = await dockerMonitor.getContainerInfo(
              containerId
            );
            const embed =
              embedBuilder.createContainerDetailsEmbed(containerInfo);

            // Update button states
            const startButton =
              interaction.message.components[0].components.find(
                (c) => c.customId === `container_start_${containerId}`
              );
            if (startButton)
              startButton.setDisabled(containerInfo.state.running);

            const stopButton =
              interaction.message.components[0].components.find(
                (c) => c.customId === `container_stop_${containerId}`
              );
            if (stopButton)
              stopButton.setDisabled(!containerInfo.state.running);

            const restartButton =
              interaction.message.components[0].components.find(
                (c) => c.customId === `container_restart_${containerId}`
              );
            if (restartButton)
              restartButton.setDisabled(!containerInfo.state.running);

            await interaction.editReply({
              embeds: [embed],
              components: interaction.message.components,
            });
          } else if (action === "logs") {
            await interaction.deferUpdate();
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
            await interaction.deferUpdate();
            const containerInfo = await dockerMonitor.getContainerInfo(
              containerId
            );
            const embed =
              embedBuilder.createContainerDetailsEmbed(containerInfo);

            await interaction.editReply({ embeds: [embed] });
          }
        }

        // Container refresh button
        else if (customId.startsWith("refresh_container_")) {
          await interaction.deferUpdate();
          const containerId = customId.replace("refresh_container_", "");
          const containerInfo = await dockerMonitor.getContainerInfo(
            containerId
          );
          const embed = embedBuilder.createContainerDetailsEmbed(containerInfo);
          await interaction.editReply({ embeds: [embed] });
        }

        // Container logs refresh button
        else if (customId.startsWith("refresh_logs_")) {
          await interaction.deferUpdate();
          const containerId = customId.replace("refresh_logs_", "");
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
        }

        // Docker containers button - shows container list
        else if (customId === "docker_containers") {
          await interaction.deferUpdate();

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

          const row = new ActionRowBuilder().addComponents(
            refreshButton,
            dockerInfoButton
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
          await interaction.deferUpdate();

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

          const row = new ActionRowBuilder().addComponents(
            refreshButton,
            dockerContainers
          );

          await interaction.editReply({ embeds: [embed], components: [row] });
        }
      } catch (error) {
        console.error("Error handling button interaction:", error);
        await interaction.reply({
          content: "There was an error handling this interaction.",
          ephemeral: true,
        });
      }
    }
  },
};

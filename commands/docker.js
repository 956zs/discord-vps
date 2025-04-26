/*
 * docker.js - Docker容器監控與管理命令
 *
 * 此文件包含Discord斜線命令 "/docker" 的所有功能，允許用戶:
 * 1. 查看Docker系統資訊 (/docker info)
 * 2. 列出所有容器 (/docker containers)
 * 3. 查看特定容器的詳細資訊 (/docker details)
 * 4. 查看容器日誌 (/docker logs)
 * 5. 控制容器狀態 (/docker control)
 *
 * 主要特色功能:
 * - 自動完成功能: 在輸入容器名稱/ID時，會顯示下拉選單供選擇
 *   實現方式是通過autocomplete()函數，當用戶開始輸入時會被Discord調用
 *   它會根據用戶的輸入過濾匹配的容器，並以選單形式顯示
 *   這種實時選單功能讓用戶不需要記住或輸入完整的容器ID
 *
 * - 互動按鈕: 每個命令回應都包含互動按鈕，如刷新、啟動、停止等
 *   這些按鈕點擊後會觸發interactionCreate事件，在events/interactionCreate.js中處理
 *   按鈕會根據容器狀態自動啟用或禁用，避免不必要的操作
 *
 * - 子命令結構: 使用Discord.js的子命令結構，將不同功能組織在一個主命令下
 *   每個子命令可以有自己的選項和參數，形成層級式的命令結構
 *
 * - 選項選單: 某些選項如 "action" 提供預定義的選項列表(啟動/停止/重啟)
 *   這會在Discord界面中顯示為下拉選單，方便用戶選擇
 *   選項由 .addChoices() 方法定義，每個選項包含顯示名稱和實際值
 *
 * - 熱更新功能： 指令可以不需重啟機器人就更新
 *   通過執行 npm run deploy 可以重新部署所有指令到Discord
 *   Discord會自動更新用戶看到的命令界面
 *
 * - 多層級的參數選項：
 *   1. 必填vs選填參數：通過setRequired()設置
 *   2. 不同類型的參數：字串、布爾值、整數等
 *   3. 自動完成參數：通過setAutocomplete()啟用
 */

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
  // 自動完成功能處理邏輯
  // 當用戶在輸入容器選項時，此函數會被Discord自動調用
  // 工作原理：
  // 1. 用戶開始輸入容器名稱/ID
  // 2. Discord客戶端發送autocomplete事件到機器人
  // 3. 此函數接收事件並獲取用戶正在輸入的內容
  // 4. 根據輸入內容過濾匹配的容器列表
  // 5. 將匹配結果轉換為選單格式並回傳給Discord
  // 6. Discord顯示下拉選單給用戶選擇
  // 7. 用戶選擇後，選擇的值會被傳遞給execute函數的對應選項
  async autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);

    if (focusedOption.name === "container") {
      try {
        const containers = await dockerMonitor.listContainers(true);
        const filtered = containers.filter((container) => {
          const search = focusedOption.value.toLowerCase();

          return (
            container.names.some((name) =>
              name.toLowerCase().includes(search)
            ) || container.id.toLowerCase().includes(search)
          );
        });

        const choices = filtered
          .map((container) => ({
            name: `${container.names[0] || container.id} (${container.state})`,
            value: container.names[0] || container.id,
          }))
          .slice(0, 25);

        await interaction.respond(choices);
      } catch (error) {
        console.error("Error in docker autocomplete:", error);
        await interaction.respond([]);
      }
    }
  },
};

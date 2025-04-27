/*
 * docker.js - Docker容器監控與管理命令
 *
 * 此文件包含Discord斜線命令 "/docker" 的所有功能，允許用戶:
 * 1. 查看Docker系統資訊 (/docker info)
 * 2. 列出所有容器 (/docker containers)
 * 3. 查看容器日誌 (/docker logs)
 * 4. 控制容器狀態 (/docker control)
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
  EmbedBuilder,
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
        .addBooleanOption((option) =>
          option
            .setName("download")
            .setDescription("Download full logs as a file")
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
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("images").setDescription("List all Docker images")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("pull")
        .setDescription("Pull a Docker image from registry")
        .addStringOption((option) =>
          option
            .setName("image")
            .setDescription("Image name and tag (e.g. ubuntu:latest)")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommandGroup((group) =>
      group
        .setName("compose")
        .setDescription("Docker Compose 多容器管理")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("list")
            .setDescription("列出所有 Docker Compose 專案")
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("details")
            .setDescription("查看 Docker Compose 專案詳情")
            .addStringOption((option) =>
              option
                .setName("project")
                .setDescription("專案名稱或 docker-compose.yml 文件路徑")
                .setRequired(true)
                .setAutocomplete(true)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("pull")
            .setDescription("拉取 Docker Compose 專案的所有映像")
            .addStringOption((option) =>
              option
                .setName("project")
                .setDescription("專案名稱或 docker-compose.yml 文件路徑")
                .setRequired(true)
                .setAutocomplete(true)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("control")
            .setDescription("控制 Docker Compose 專案 (啟動、停止、重啟)")
            .addStringOption((option) =>
              option
                .setName("project")
                .setDescription("專案名稱或 docker-compose.yml 文件路徑")
                .setRequired(true)
                .setAutocomplete(true)
            )
            .addStringOption((option) =>
              option
                .setName("action")
                .setDescription("要執行的操作")
                .setRequired(true)
                .addChoices(
                  { name: "啟動 (up)", value: "up" },
                  { name: "停止 (down)", value: "down" },
                  { name: "重啟 (restart)", value: "restart" }
                )
            )
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const subcommand = interaction.options.getSubcommand();
    const group = interaction.options.getSubcommandGroup(false);

    try {
      if (group === "compose") {
        if (subcommand === "list") {
          const projects = await dockerMonitor.listComposeProjects();
          const embed = embedBuilder.createComposeProjectsListEmbed(projects);

          const refreshButton = new ButtonBuilder()
            .setCustomId("refresh_compose_projects")
            .setLabel("刷新")
            .setStyle(ButtonStyle.Primary);

          const row = new ActionRowBuilder().addComponents(refreshButton);

          await interaction.editReply({ embeds: [embed], components: [row] });
        } else if (subcommand === "details") {
          const projectName = interaction.options.getString("project");

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
              `Error getting compose details for ${projectName}:`,
              error
            );
            await interaction.editReply({
              content: `獲取 Docker Compose 專案詳情時出錯: ${error.message}`,
              components: [],
            });
          }
        } else if (subcommand === "pull") {
          const projectName = interaction.options.getString("project");

          await interaction.editReply({
            content: `🔄 正在拉取 Docker Compose 專案 \`${projectName}\` 的映像... 這可能需要一些時間，取決於映像大小。`,
            components: [],
          });

          try {
            const pullResult = await dockerMonitor.pullComposeImages(
              projectName
            );

            const embed = embedBuilder.createComposePullResultEmbed(pullResult);

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

            await interaction.editReply({
              content: null,
              embeds: [embed],
              components: [row],
            });
          } catch (error) {
            console.error(`Error pulling images for ${projectName}:`, error);

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
        } else if (subcommand === "control") {
          const projectName = interaction.options.getString("project");
          const action = interaction.options.getString("action");

          await interaction.editReply({
            content: `🔄 正在對 Docker Compose 專案 \`${projectName}\` 執行 \`${action}\` 操作... 請稍候。`,
            components: [],
          });

          try {
            const result = await dockerMonitor.controlComposeProject(
              projectName,
              action
            );

            const embed =
              embedBuilder.createComposeOperationResultEmbed(result);

            const detailsButton = new ButtonBuilder()
              .setCustomId(
                `refresh_compose_details_${encodeURIComponent(projectName)}`
              )
              .setLabel("查看專案詳情")
              .setStyle(ButtonStyle.Primary);

            const row = new ActionRowBuilder().addComponents(detailsButton);

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
      } else if (subcommand === "info") {
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
      } else if (subcommand === "logs") {
        const containerId = interaction.options.getString("container");
        const lines = interaction.options.getInteger("lines") || 100;
        const download = interaction.options.getBoolean("download") || false;

        const containerInfo = await dockerMonitor.getContainerInfo(containerId);
        const logs = await dockerMonitor.getContainerLogs(
          containerId,
          download ? null : lines
        );

        if (download) {
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
          });
        } else {
          // Display logs in embed as before
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
      } else if (subcommand === "images") {
        // List all Docker images
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
      } else if (subcommand === "pull") {
        // Pull a Docker image
        const imageName = interaction.options.getString("image");

        // Send initial response
        await interaction.editReply({
          content: `🔄 Pulling Docker image \`${imageName}\`... This may take a while depending on the image size.`,
          components: [],
        });

        try {
          // Execute the pull operation
          const pullResult = await dockerMonitor.pullImage(imageName);

          // Create an embed with the result
          const embed = embedBuilder.createImagePullEmbed(pullResult);

          // 檢查是否有容器正在使用此映像
          const allContainers = await dockerMonitor.listContainers(true);
          const imageContainers = allContainers.filter(
            (container) =>
              container.image === imageName ||
              container.image.startsWith(`${imageName}@sha256:`)
          );

          if (imageContainers.length > 0) {
            // 添加使用此映像的容器資訊到嵌入訊息中
            embed.addFields({
              name: "相關容器",
              value: `找到 ${imageContainers.length} 個使用此映像的容器。您可能需要重啟這些容器以使用新映像。`,
              inline: false,
            });

            // 如果容器數量不多，列出容器名稱
            if (imageContainers.length <= 5) {
              const containerList = imageContainers
                .map((c) => `• \`${c.names[0] || c.id}\` (${c.state})`)
                .join("\n");

              embed.addFields({
                name: "容器列表",
                value: containerList,
                inline: false,
              });
            }

            embed.addFields({
              name: "更新步驟",
              value:
                "要更新這些容器使用的映像，請遵循以下步驟：\n1. 使用 `/docker control` 停止容器\n2. 刪除舊容器 (未來功能)\n3. 使用新映像創建新容器 (未來功能)",
              inline: false,
            });
          }

          // Create buttons
          const viewImagesButton = new ButtonBuilder()
            .setCustomId("docker_images")
            .setLabel("View All Images")
            .setStyle(ButtonStyle.Primary);

          const relatedContainersButton = new ButtonBuilder()
            .setCustomId(
              `find_image_containers_${encodeURIComponent(imageName)}`
            )
            .setLabel("Find Related Containers")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(imageContainers.length === 0); // 如果沒有相關容器則禁用按鈕

          const row = new ActionRowBuilder().addComponents(
            viewImagesButton,
            relatedContainersButton
          );

          // Update reply with the result
          await interaction.editReply({
            content: null,
            embeds: [embed],
            components: [row],
          });
        } catch (error) {
          console.error(`Error pulling image ${imageName}:`, error);

          // Create an embed for the error
          const embed = new EmbedBuilder()
            .setColor("#FF0000")
            .setTitle(`Docker Image Pull Failed: ${imageName}`)
            .setDescription(`❌ Failed to pull image \`${imageName}\``)
            .addFields({
              name: "Error",
              value: error.message || "Unknown error occurred",
            })
            .setTimestamp();

          await interaction.editReply({
            content: null,
            embeds: [embed],
            components: [],
          });
        }
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
    const group = interaction.options.getSubcommandGroup(false);

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
    } else if (focusedOption.name === "image") {
      try {
        // 取得所有本地映像
        const images = await dockerMonitor.listImages();

        // 根據使用者輸入過濾映像
        const search = focusedOption.value.toLowerCase();
        const filtered = images.filter((image) => {
          // 搜尋映像的標籤中是否含有使用者輸入的文字
          return image.repoTags.some((tag) =>
            tag.toLowerCase().includes(search)
          );
        });

        // 建立選單選項
        const choices = [];

        // 先加入符合搜尋的本地映像
        filtered.forEach((image) => {
          // 一個映像可能有多個標籤，我們為每個標籤提供選項
          image.repoTags.forEach((tag) => {
            if (tag !== "<none>:<none>" && tag.toLowerCase().includes(search)) {
              choices.push({
                name: `${tag} (local)`,
                value: tag,
              });
            }
          });
        });

        // 如果使用者輸入了有效的映像名稱格式，但不在本地映像中，也提供建議
        if (search.includes(":") || !search.includes(" ")) {
          // 檢查是否已經在建議列表中
          const exists = choices.some(
            (choice) => choice.value.toLowerCase() === search
          );

          if (!exists && search.length > 0) {
            choices.push({
              name: `${focusedOption.value} (pull from registry)`,
              value: focusedOption.value,
            });
          }
        }

        // 回傳建議選項，最多25個
        await interaction.respond(choices.slice(0, 25));
      } catch (error) {
        console.error("Error in image autocomplete:", error);
        await interaction.respond([]);
      }
    } else if (focusedOption.name === "project" && group === "compose") {
      try {
        // 獲取 Docker Compose 項目列表
        const projects = await dockerMonitor.listComposeProjects();

        // 根據用戶輸入過濾項目
        const search = focusedOption.value.toLowerCase();
        const filtered = projects.filter((project) =>
          project.name.toLowerCase().includes(search)
        );

        // 構建選項列表
        const choices = filtered.map((project) => ({
          name: `${project.name} (${project.status})`,
          value: project.name,
        }));

        // 檢查是否像是文件路徑
        if (
          search.includes("/") ||
          search.includes(".yml") ||
          search.includes(".yaml")
        ) {
          // 如果用戶輸入看起來像是一個文件路徑，添加它作為選項
          const exists = choices.some(
            (choice) => choice.value === focusedOption.value
          );

          if (!exists) {
            choices.push({
              name: `${focusedOption.value} (文件路徑)`,
              value: focusedOption.value,
            });
          }
        }

        await interaction.respond(choices.slice(0, 25));
      } catch (error) {
        console.error("Error in compose project autocomplete:", error);

        // 在錯誤情況下，如果輸入看起來像是文件路徑，也提供它作為選項
        const search = focusedOption.value;
        if (
          search.includes("/") ||
          search.includes(".yml") ||
          search.includes(".yaml")
        ) {
          await interaction.respond([
            {
              name: `${search} (文件路徑)`,
              value: search,
            },
          ]);
        } else {
          await interaction.respond([]);
        }
      }
    }
  },
};

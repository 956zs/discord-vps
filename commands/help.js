// 導入必要的Discord.js模組
// SlashCommandBuilder: 用於建立斜線指令
// EmbedBuilder: 用於創建美觀的嵌入式訊息
const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  // 定義斜線指令的基本資訊
  data: new SlashCommandBuilder()
    .setName("help") // 指令名稱為"help"
    .setDescription("顯示所有可用的指令和功能") // 指令的描述文字
    // 添加一個可選參數，讓用戶可以指定想查詢的具體指令
    .addStringOption((option) =>
      option
        .setName("指令") // 參數名稱
        .setDescription("指定想查詢的指令") // 參數描述
        .setRequired(false) // 設為非必填
        // 添加預設選項，這些選項會在Discord介面顯示為下拉選單
        .addChoices(
          { name: "系統監控", value: "system" }, // 顯示名稱與實際值
          { name: "Docker管理", value: "docker" }
        )
    ),

  // 當指令被執行時的處理邏輯
  async execute(interaction) {
    // 獲取用戶在下拉選單中選擇的選項
    const commandChoice = interaction.options.getString("指令");

    // 根據用戶的選擇顯示不同的幫助內容
    if (commandChoice === "system") {
      // 如果用戶選擇了"系統監控"
      // 創建一個系統監控相關指令的嵌入式訊息
      const embed = new EmbedBuilder()
        .setColor("#0099ff") // 設定顏色（藍色）
        .setTitle("系統監控指令") // 設定標題
        .setDescription("用於監控VPS系統狀態的指令") // 設定描述
        // 添加多個欄位來展示各個子指令的用法
        .addFields(
          {
            name: "/system info", // 子指令名稱
            value: "顯示系統基本資訊，包括CPU、記憶體、硬碟使用情況等。", // 子指令說明
          },
          { name: "/system network", value: "顯示網路介面和流量統計信息。" },
          { name: "/system processes", value: "列出佔用CPU最高的進程。" }
        )
        // 添加底部文字說明
        .setFooter({ text: "所有指令均有刷新按鈕，可即時更新資訊。" });

      // 回應用戶的互動，發送嵌入式訊息
      await interaction.reply({ embeds: [embed] });
    } else if (commandChoice === "docker") {
      // 如果用戶選擇了"Docker管理"
      // 創建一個Docker管理相關指令的嵌入式訊息
      const embed = new EmbedBuilder()
        .setColor("#2496ED") // 設定顏色（Docker藍）
        .setTitle("Docker管理指令") // 設定標題
        .setDescription("用於監控和管理Docker容器的指令") // 設定描述
        // 添加多個欄位來展示各個子指令的用法及其參數
        .addFields(
          {
            name: "/docker info",
            value: "顯示Docker系統資訊，包括版本、資源使用等。",
          },
          {
            name: "/docker containers",
            value:
              "列出所有Docker容器。\n參數：`all` - 是否包括已停止的容器（預設為是）",
          },
          {
            name: "/docker logs",
            value:
              "顯示容器的日誌。\n參數：`container` - 容器ID或名稱（支援自動完成）\n參數：`lines` - 顯示的行數（選填）\n參數：`download` - 是否下載完整日誌文件（選填）",
          },
          {
            name: "/docker control",
            value:
              "控制容器（啟動、停止、重啟）。\n參數：`container` - 容器ID或名稱（支援自動完成）\n參數：`action` - 操作（啟動/停止/重啟）",
          }
        )
        // 添加底部文字說明
        .setFooter({ text: "大多數指令都有互動按鈕，方便進行常見操作。" });

      // 回應用戶的互動，發送嵌入式訊息
      await interaction.reply({ embeds: [embed] });
    } else {
      // 如果用戶沒有選擇具體指令（或直接輸入/help）
      // 創建一個總覽性質的嵌入式訊息
      const mainEmbed = new EmbedBuilder()
        .setColor("#5865F2") // 設定顏色（Discord藍）
        .setTitle("VPS監控機器人幫助") // 設定總標題
        .setDescription(
          "這個機器人可以幫助你監控VPS的系統狀態和管理Docker容器。"
        ) // 設定總描述
        // 添加分類欄位，每個分類包含簡要的指令列表
        .addFields(
          {
            name: "🖥️ 系統監控", // 使用表情符號增加視覺效果
            value:
              "`/system info` - 系統資訊\n`/system network` - 網路狀態\n`/system processes` - 進程列表\n\n使用 `/help 系統監控` 查看詳細資訊",
          },
          {
            name: "🐳 Docker管理", // Docker鯨魚表情
            value:
              "`/docker info` - Docker資訊\n`/docker containers` - 容器列表\n`/docker logs` - 容器日誌\n`/docker control` - 容器控制\n\n使用 `/help Docker管理` 查看詳細資訊",
          },
          {
            name: "使用提示", // 額外提示
            value:
              "• 所有監控頁面都包含刷新按鈕\n• Docker容器管理支援自動完成\n• 容器詳情頁面有快速操作按鈕",
          }
        )
        // 添加底部說明，引導用戶獲取更詳細的幫助
        .setFooter({ text: "使用 /help [指令名稱] 查看特定指令的詳細資訊" });

      // 回應用戶的互動，發送總覽嵌入式訊息
      await interaction.reply({ embeds: [mainEmbed] });
    }
  },
};

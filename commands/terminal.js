/*
 * terminal.js - Discord上執行VPS終端命令的功能
 *
 * 此文件提供以下功能:
 * 1. 執行單一終端命令並顯示結果
 * 2. 建立互動式終端會話，讓用戶可以連續輸入命令
 * 3. 支援全息模式，直接在Discord頻道輸入即可執行命令
 */

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} = require("discord.js");
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);

// 追蹤活躍的終端會話
const activeSessions = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName("terminal")
    .setDescription("在VPS上執行終端命令")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("run")
        .setDescription("執行單一終端命令")
        .addStringOption((option) =>
          option
            .setName("command")
            .setDescription("要執行的命令")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("session").setDescription("啟動一個互動式終端會話")
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === "run") {
        // 執行單一命令模式
        const command = interaction.options.getString("command");

        // 獲取當前系統目錄
        const { stdout: currentDir } = await execPromise("pwd");
        const result = await executeCommand(command, currentDir.trim());

        // 建立回應嵌入和按鈕
        const embed = createCommandEmbed(command, result);

        // 創建重新執行按鈕
        const rerunButton = new ButtonBuilder()
          .setCustomId(`rerun_${Buffer.from(command).toString("base64")}`)
          .setLabel("重新執行")
          .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(rerunButton);

        await interaction.editReply({ embeds: [embed], components: [row] });
      } else if (subcommand === "session") {
        // 啟動互動式終端會話
        const userId = interaction.user.id;

        // 檢查用戶是否已有活躍會話
        if (activeSessions.has(userId)) {
          await interaction.editReply(
            "你已經有一個活躍的終端會話。請先關閉它再開啟新的會話。"
          );
          return;
        }

        // 創建初始嵌入訊息
        const embed = new EmbedBuilder()
          .setColor("#00FF00")
          .setTitle("VPS 終端會話")
          .setDescription(
            "互動式終端會話已開始。直接在頻道中發送訊息來執行命令。"
          )
          .addFields(
            { name: "當前目錄", value: "```正在獲取...```" },
            { name: "歷史命令", value: "無" },
            {
              name: "使用說明",
              value: "直接輸入命令來執行，或點擊下方按鈕結束會話。",
            }
          )
          .setTimestamp();

        // 創建結束會話按鈕
        const endButton = new ButtonBuilder()
          .setCustomId(`end_session_${userId}`)
          .setLabel("結束會話")
          .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(endButton);

        const reply = await interaction.editReply({
          embeds: [embed],
          components: [row],
        });

        // 獲取當前目錄並更新嵌入訊息
        const { stdout: currentDir } = await execPromise("pwd");
        const workingDirectory = currentDir.trim();
        embed.data.fields[0].value = `\`\`\`${workingDirectory}\`\`\``;
        await interaction.editReply({ embeds: [embed], components: [row] });

        // 建立會話並儲存資訊
        activeSessions.set(userId, {
          channelId: interaction.channelId,
          messageId: reply.id,
          embed: embed,
          commands: [],
          currentDir: workingDirectory,
        });

        console.log(`終端會話已為用戶 ${interaction.user.tag} 啟動`);
      }
    } catch (error) {
      console.error("執行終端命令時發生錯誤:", error);
      await interaction.editReply({
        content: `執行命令時發生錯誤: ${error.message}`,
      });
    }
  },

  // 消息監聽函數，用於處理會話中的命令
  async handleMessage(message, client) {
    const userId = message.author.id;

    // 檢查用戶是否有活躍會話
    if (!activeSessions.has(userId)) return;

    // 獲取會話資訊
    const session = activeSessions.get(userId);

    // 確認消息是在正確的頻道
    if (message.channelId !== session.channelId) return;

    // 防止處理機器人訊息
    if (message.author.bot) return;

    // 取得命令文字
    const command = message.content;

    try {
      // 執行命令在當前會話目錄
      const result = await executeCommand(command, session.currentDir);

      // 如果是cd命令，處理目錄變更
      if (command.trim().startsWith("cd ") && result.newWorkingDir) {
        // 更新當前目錄
        session.currentDir = result.newWorkingDir;

        // 更新命令歷史
        session.commands.push({
          command,
          result: `Changed directory to: ${result.newWorkingDir}`,
        });

        // 更新嵌入訊息
        updateSessionEmbed(session, userId);

        // 獲取原始會話訊息並更新
        const channel = await client.channels.fetch(session.channelId);
        const sessionMessage = await channel.messages.fetch(session.messageId);

        await sessionMessage.edit({
          embeds: [session.embed],
          components: sessionMessage.components,
        });

        await message.reply(`目錄已更改至: ${result.newWorkingDir}`);
        return;
      }

      // 更新命令歷史
      session.commands.push({ command, result: result.stdout });

      // 更新嵌入訊息
      updateSessionEmbed(session, userId);

      // 獲取原始會話訊息並更新
      const channel = await client.channels.fetch(session.channelId);
      const sessionMessage = await channel.messages.fetch(session.messageId);

      await sessionMessage.edit({
        embeds: [session.embed],
        components: sessionMessage.components,
      });

      // 發送命令執行結果
      let responseContent = "";

      if (result.stdout) {
        responseContent += `輸出:\n\`\`\`\n${truncateOutput(
          result.stdout,
          1900
        )}\n\`\`\``;
      }

      if (result.stderr) {
        responseContent += `錯誤:\n\`\`\`\n${truncateOutput(
          result.stderr,
          1900
        )}\n\`\`\``;
      }

      if (responseContent) {
        await message.reply(responseContent);
      } else {
        await message.reply("命令已執行，沒有輸出。");
      }
    } catch (error) {
      console.error("執行終端命令時發生錯誤:", error);
      await message.reply(`執行命令時發生錯誤: ${error.message}`);
    }
  },

  // 按鈕互動處理
  async handleInteraction(interaction) {
    if (!interaction.isButton()) return;

    const customId = interaction.customId;

    // 處理重新執行按鈕
    if (customId.startsWith("rerun_")) {
      await interaction.deferUpdate();

      // 從按鈕ID中解碼命令
      const encodedCommand = customId.replace("rerun_", "");
      const command = Buffer.from(encodedCommand, "base64").toString();

      try {
        // 重新執行命令 (使用當前系統目錄)
        const { stdout: currentDir } = await execPromise("pwd");
        const result = await executeCommand(command, currentDir.trim());

        // 建立新的嵌入訊息
        const embed = createCommandEmbed(command, result);

        // 更新訊息
        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error("重新執行終端命令時發生錯誤:", error);
        await interaction.followUp({
          content: `重新執行命令時發生錯誤: ${error.message}`,
          ephemeral: true,
        });
      }
    }
    // 處理結束會話按鈕
    else if (customId.startsWith("end_session_")) {
      await interaction.deferUpdate();

      const userId = customId.replace("end_session_", "");

      // 確認是否是會話擁有者
      if (interaction.user.id !== userId) {
        await interaction.followUp({
          content: "只有會話的啟動者可以結束會話。",
          ephemeral: true,
        });
        return;
      }

      // 移除會話
      if (activeSessions.has(userId)) {
        const session = activeSessions.get(userId);

        // 更新嵌入訊息顯示會話已結束
        const embed = EmbedBuilder.from(session.embed)
          .setColor("#FF0000")
          .setTitle("終端會話已結束")
          .setDescription("此終端會話已關閉。")
          .setTimestamp();

        await interaction.editReply({
          embeds: [embed],
          components: [],
        });

        // 移除會話
        activeSessions.delete(userId);
        console.log(`終端會話已為用戶 ${interaction.user.tag} 結束`);
      }
    }
  },
};

// 執行指令並返回結果
async function executeCommand(command, workingDir = null) {
  try {
    const options = {};

    // If a working directory is specified, use it
    if (workingDir) {
      options.cwd = workingDir;
    }

    // Special handling for 'cd' command, since it affects the process state
    if (command.trim().startsWith("cd ")) {
      const dir = command.trim().substring(3);

      // Execute the cd command and then check the new directory
      // When workingDir is provided, change directory relative to it
      if (workingDir) {
        const { stdout: newDir } = await execPromise(
          `cd "${workingDir}" && cd ${dir} && pwd`,
          options
        );
        return {
          stdout: "",
          stderr: "",
          newWorkingDir: newDir.trim(),
        };
      } else {
        const { stdout: newDir } = await execPromise(`cd ${dir} && pwd`);
        return {
          stdout: "",
          stderr: "",
          newWorkingDir: newDir.trim(),
        };
      }
    }

    // For all other commands
    const { stdout, stderr } = await execPromise(command, options);
    return { stdout, stderr };
  } catch (error) {
    // 如果命令執行失敗，stderr會包含在error對象中
    return {
      stdout: error.stdout || "",
      stderr: error.stderr || error.message,
    };
  }
}

// 建立命令執行結果的嵌入訊息
function createCommandEmbed(command, result) {
  const embed = new EmbedBuilder()
    .setColor("#0099ff")
    .setTitle("終端命令執行結果")
    .addFields({ name: "執行的命令", value: `\`\`\`${command}\`\`\`` })
    .setTimestamp();

  if (result.stdout) {
    embed.addFields({
      name: "標準輸出",
      value: `\`\`\`\n${truncateOutput(result.stdout, 1000)}\n\`\`\``,
    });
  }

  if (result.stderr) {
    embed.addFields({
      name: "標準錯誤",
      value: `\`\`\`\n${truncateOutput(result.stderr, 1000)}\n\`\`\``,
    });
    embed.setColor("#ff0000");
  }

  return embed;
}

// 更新會話嵌入訊息
function updateSessionEmbed(session, userId) {
  // 顯示最近5條命令
  const recentCommands = session.commands
    .slice(-5)
    .map((cmd, index) => {
      return `${index + 1}. \`${cmd.command}\``;
    })
    .join("\n");

  // 更新嵌入訊息
  session.embed.data.fields[0].value = `\`\`\`${session.currentDir}\`\`\``;
  session.embed.data.fields[1].value = recentCommands || "無";

  return session.embed;
}

// 截斷過長的輸出
function truncateOutput(output, maxLength) {
  if (output.length <= maxLength) return output;

  return output.substring(0, maxLength) + "\n... (輸出被截斷)";
}

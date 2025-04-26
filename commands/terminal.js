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

        try {
          // 獲取當前目錄並確保它是絕對路徑
          const { stdout: rawCurrentDir } = await execPromise("pwd", {
            shell: true,
          });
          const workingDirectory = rawCurrentDir.trim();

          // 確認目錄存在
          await execPromise(`test -d "${workingDirectory}"`, { shell: true });

          // 更新嵌入訊息顯示目錄
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

          console.log(
            `終端會話已為用戶 ${interaction.user.tag} 啟動，目錄: ${workingDirectory}`
          );
        } catch (error) {
          console.error("設置終端會話時發生錯誤:", error);
          embed.setColor("#FF0000");
          embed.setDescription("啟動終端會話時發生錯誤: " + error.message);
          await interaction.editReply({ embeds: [embed], components: [] });
        }
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

    // 特殊命令: debug-dir - 顯示當前的工作目錄
    if (command.trim() === "debug-dir") {
      try {
        await message.reply(`目前的會話目錄: \`${session.currentDir}\``);

        // 驗證目錄是否真的存在
        const { stdout: dirTest } = await execPromise(
          `if [ -d "${session.currentDir}" ]; then echo "存在"; else echo "不存在"; fi`,
          { shell: true }
        );
        await message.reply(`該目錄${dirTest.trim()}`);

        // 列出目錄內容
        const { stdout: dirContents } = await execPromise(
          `ls -la "${session.currentDir}"`,
          { shell: true }
        );
        await message.reply(`目錄內容:\n\`\`\`\n${dirContents}\n\`\`\``);

        return;
      } catch (error) {
        await message.reply(`檢查目錄時發生錯誤: ${error.message}`);
        return;
      }
    }

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
    const options = {
      shell: true, // Use shell for consistent path handling
    };

    // If a working directory is specified, use it
    if (workingDir) {
      options.cwd = workingDir;
      console.log(`執行命令: "${command}" 在目錄: "${workingDir}"`);
    } else {
      console.log(`執行命令: "${command}" 在默認目錄`);
    }

    // Special case for ls command - always show verbose output
    if (command.trim() === "ls") {
      // Make it more obvious by using ls -la
      command = "ls -la";
    }

    // Special case for pwd command - always return the current working directory
    if (command.trim() === "pwd") {
      try {
        // First try to get it from options.cwd
        const actualDir =
          workingDir || (await execPromise("pwd", options)).stdout.trim();
        console.log(`pwd命令返回: "${actualDir}"`);
        return {
          stdout: actualDir,
          stderr: "",
        };
      } catch (error) {
        console.error("pwd命令錯誤:", error);
        return {
          stdout: "無法獲取當前目錄",
          stderr: error.message,
        };
      }
    }

    // Special handling for 'cd' command, since it affects the process state
    if (command.trim().startsWith("cd ")) {
      const dir = command.trim().substring(3);
      console.log(`處理cd命令: "${dir}" 從目錄: "${workingDir}"`);

      try {
        // Calculate the new directory path
        let newDir;

        if (dir.startsWith("/")) {
          // Absolute path
          newDir = dir;
          console.log(`使用絕對路徑: "${newDir}"`);
        } else if (dir === "~") {
          // Home directory
          newDir = (
            await execPromise("echo $HOME", { shell: true })
          ).stdout.trim();
          console.log(`使用家目錄: "${newDir}"`);
        } else if (workingDir) {
          // Relative path with working dir
          // Use path.resolve in shell to handle .. and . properly
          const { stdout } = await execPromise(
            `cd "${workingDir}" && cd "${dir}" && pwd`,
            { shell: true }
          );
          newDir = stdout.trim();
          console.log(
            `解析相對路徑: "${dir}" 從 "${workingDir}" 得到 "${newDir}"`
          );
        } else {
          // Relative path without working dir
          const { stdout } = await execPromise(`cd "${dir}" && pwd`, {
            shell: true,
          });
          newDir = stdout.trim();
          console.log(`解析相對路徑: "${dir}" 從默認目錄得到 "${newDir}"`);
        }

        // Verify the directory exists and is accessible
        await execPromise(`test -d "${newDir}"`, { shell: true });
        console.log(`確認目錄存在: "${newDir}"`);

        return {
          stdout: "",
          stderr: "",
          newWorkingDir: newDir,
        };
      } catch (error) {
        console.error(`cd命令錯誤:`, error);
        return {
          stdout: "",
          stderr: `cd: ${dir}: No such file or directory`,
        };
      }
    }

    // For all other commands, execute in the specified directory
    const { stdout, stderr } = await execPromise(command, options);
    return { stdout, stderr };
  } catch (error) {
    console.error(`執行命令錯誤: "${command}"`, error);
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

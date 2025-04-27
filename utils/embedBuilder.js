const { EmbedBuilder } = require("discord.js");

/**
 * Create a system information embed
 * @param {Object} systemInfo - System information from systemMonitor.js
 * @returns {EmbedBuilder} Discord embed
 */
function createSystemInfoEmbed(systemInfo) {
  const embed = new EmbedBuilder()
    .setColor("#0099ff")
    .setTitle("VPS System Information")
    .setDescription("Current system status and resource usage")
    .setTimestamp()
    .addFields(
      {
        name: "CPU",
        value: `${systemInfo.cpu.brand} (${systemInfo.cpu.cores} Cores)`,
        inline: true,
      },
      { name: "CPU Usage", value: `${systemInfo.cpu.usage}%`, inline: true },
      {
        name: "System",
        value: `${systemInfo.os.distro} ${systemInfo.os.release}`,
        inline: true,
      },
      {
        name: "Memory",
        value: `Used: ${systemInfo.memory.used}GB / ${systemInfo.memory.total}GB (${systemInfo.memory.usedPercentage}%)`,
        inline: false,
      },
      {
        name: "Uptime",
        value: `${systemInfo.uptime.days} days, ${systemInfo.uptime.hours} hours, ${systemInfo.uptime.minutes} minutes`,
        inline: true,
      }
    );

  // Add disk information
  systemInfo.disks.forEach((disk, index) => {
    if (index < 3) {
      // Limit to first 3 disks to avoid embed limit
      embed.addFields({
        name: `Disk ${disk.fs}`,
        value: `Used: ${disk.used}GB / ${disk.size}GB (${disk.usedPercentage}%)`,
        inline: true,
      });
    }
  });

  return embed;
}

/**
 * Create a network information embed
 * @param {Object} networkInfo - Network information from systemMonitor.js
 * @returns {EmbedBuilder} Discord embed
 */
function createNetworkInfoEmbed(networkInfo) {
  const embed = new EmbedBuilder()
    .setColor("#00cc99")
    .setTitle("VPS Network Information")
    .setDescription("Network interfaces and statistics")
    .setTimestamp();

  // Add network interfaces
  networkInfo.interfaces.forEach((iface, index) => {
    if (index < 5 && iface.operstate === "up") {
      // Limit to first 5 active interfaces
      embed.addFields({
        name: `Interface: ${iface.name}`,
        value: `IP: ${iface.ip4}\nMAC: ${iface.mac}\nType: ${iface.type}\nSpeed: ${iface.speed} Mbps`,
        inline: true,
      });
    }
  });

  // Add network stats
  networkInfo.stats.forEach((stat, index) => {
    if (index < 5) {
      // Limit to first 5 interfaces
      embed.addFields({
        name: `Traffic: ${stat.interface}`,
        value: `Download: ${stat.rx_bytes} MB (${stat.rx_sec} KB/s)\nUpload: ${stat.tx_bytes} MB (${stat.tx_sec} KB/s)`,
        inline: true,
      });
    }
  });

  return embed;
}

/**
 * Create a process list embed
 * @param {Array} processes - Process information from systemMonitor.js
 * @returns {EmbedBuilder} Discord embed
 */
function createProcessListEmbed(processes) {
  const embed = new EmbedBuilder()
    .setColor("#ff9900")
    .setTitle("VPS Process Information")
    .setDescription("Top processes by CPU usage")
    .setTimestamp();

  // Format process list as a table-like display
  let processTable = "";
  processes.forEach((proc, index) => {
    if (index < 10) {
      // Limit to top 10 processes
      processTable += `**${index + 1}.** \`${proc.name}\` (PID: ${proc.pid})\n`;
      processTable += `   CPU: ${proc.cpu}% | Memory: ${proc.mem}% (${proc.memUsed} MB)\n\n`;
    }
  });

  embed.setDescription(processTable || "No process information available");

  return embed;
}

/**
 * Create a Docker overview embed
 * @param {Object} dockerInfo - Docker information from dockerMonitor.js
 * @returns {EmbedBuilder} Discord embed
 */
function createDockerInfoEmbed(dockerInfo) {
  const embed = new EmbedBuilder()
    .setColor("#2496ED") // Docker blue
    .setTitle("Docker System Information")
    .setDescription("Docker engine status and resource usage")
    .setTimestamp()
    .addFields(
      {
        name: "Docker Version",
        value: `${dockerInfo.version.version} (API: ${dockerInfo.version.apiVersion})`,
        inline: true,
      },
      {
        name: "Engine",
        value: `OS: ${dockerInfo.version.os}\nArch: ${dockerInfo.version.arch}`,
        inline: true,
      },
      {
        name: "Resources",
        value: `Driver: ${dockerInfo.info.driver}\nCPUs: ${dockerInfo.info.cpus}`,
        inline: true,
      },
      {
        name: "Containers",
        value: `Total: ${dockerInfo.info.containers.total}\nRunning: ${dockerInfo.info.containers.running}\nStopped: ${dockerInfo.info.containers.stopped}`,
        inline: true,
      },
      {
        name: "Images",
        value: `Count: ${dockerInfo.diskUsage.images.count}\nSize: ${dockerInfo.diskUsage.images.size} GB`,
        inline: true,
      },
      {
        name: "Storage",
        value: `Total: ${dockerInfo.diskUsage.total} GB\nVolumes: ${dockerInfo.diskUsage.volumes.size} GB`,
        inline: true,
      }
    );

  return embed;
}

/**
 * Create a container list embed
 * @param {Array} containers - Container list from dockerMonitor.js
 * @returns {EmbedBuilder} Discord embed
 */
function createContainerListEmbed(containers) {
  const embed = new EmbedBuilder()
    .setColor("#2496ED") // Docker blue
    .setTitle("Docker Containers")
    .setDescription(`Total containers: ${containers.length}`)
    .setTimestamp();

  // Group containers by state
  const running = containers.filter((c) => c.state === "running");
  const stopped = containers.filter((c) => c.state === "exited");
  const others = containers.filter(
    (c) => c.state !== "running" && c.state !== "exited"
  );

  if (running.length > 0) {
    let runningList = "";
    running.forEach((container, i) => {
      if (i < 10) {
        // Limit to 10 containers max to avoid embed limits
        const name = container.names[0] || container.id;
        runningList += `**${i + 1}.** \`${name}\` (${container.image})\n`;
        runningList += `   Status: ${container.status}\n`;
      }
    });
    if (running.length > 10) {
      runningList += `... and ${running.length - 10} more containers\n`;
    }
    embed.addFields({
      name: "✅ Running Containers",
      value: runningList,
      inline: false,
    });
  }

  if (stopped.length > 0) {
    let stoppedList = "";
    stopped.forEach((container, i) => {
      if (i < 5) {
        // Limit to 5 stopped containers
        const name = container.names[0] || container.id;
        stoppedList += `**${i + 1}.** \`${name}\` (${container.image})\n`;
        stoppedList += `   Status: ${container.status}\n`;
      }
    });
    if (stopped.length > 5) {
      stoppedList += `... and ${stopped.length - 5} more containers\n`;
    }
    embed.addFields({
      name: "⛔ Stopped Containers",
      value: stoppedList,
      inline: false,
    });
  }

  if (others.length > 0) {
    let othersList = "";
    others.forEach((container, i) => {
      if (i < 3) {
        // Limit to 3 other containers
        const name = container.names[0] || container.id;
        othersList += `**${i + 1}.** \`${name}\` (${container.image}): ${
          container.status
        }\n`;
      }
    });
    if (others.length > 3) {
      othersList += `... and ${others.length - 3} more containers\n`;
    }
    embed.addFields({
      name: "⚠️ Other Containers",
      value: othersList,
      inline: false,
    });
  }

  return embed;
}

/**
 * Create a container details embed
 * @param {Object} containerInfo - Container info from dockerMonitor.js
 * @returns {EmbedBuilder} Discord embed
 */
function createContainerDetailsEmbed(containerInfo) {
  const embed = new EmbedBuilder()
    .setColor(containerInfo.state.running ? "#2496ED" : "#990000") // Blue if running, red if stopped
    .setTitle(`Container: ${containerInfo.name}`)
    .setDescription(
      `ID: \`${containerInfo.id}\`\nImage: \`${containerInfo.image}\``
    )
    .setTimestamp()
    .addFields(
      {
        name: "Status",
        value: `${containerInfo.state.status}${
          containerInfo.state.error
            ? ` (Error: ${containerInfo.state.error})`
            : ""
        }`,
        inline: true,
      },
      {
        name: "Created",
        value: new Date(containerInfo.created).toLocaleString(),
        inline: true,
      },
      {
        name: "Started",
        value: containerInfo.state.startedAt
          ? new Date(containerInfo.state.startedAt).toLocaleString()
          : "N/A",
        inline: true,
      }
    );

  // Add stats if running
  if (containerInfo.state.running) {
    embed.addFields(
      {
        name: "CPU Usage",
        value: `${containerInfo.stats.cpu.usage}%`,
        inline: true,
      },
      {
        name: "Memory Usage",
        value: `${containerInfo.stats.memory.usage} MB / ${containerInfo.stats.memory.limit} MB (${containerInfo.stats.memory.percent}%)`,
        inline: true,
      },
      {
        name: "Network I/O",
        value: `↓ ${containerInfo.stats.network.rx_bytes} MB | ↑ ${containerInfo.stats.network.tx_bytes} MB`,
        inline: true,
      }
    );
  }

  // Add ports if any
  if (containerInfo.ports && containerInfo.ports.length > 0) {
    let portsMapping = "";
    containerInfo.ports.forEach((port) => {
      const hostPorts =
        port.hostPorts && port.hostPorts.length > 0
          ? port.hostPorts
              .map((p) => `${p.hostIp || "0.0.0.0"}:${p.hostPort}`)
              .join(", ")
          : "none";
      portsMapping += `${port.containerPort} → ${hostPorts}\n`;
    });

    if (portsMapping) {
      embed.addFields({
        name: "Port Mappings",
        value: portsMapping,
        inline: false,
      });
    }
  }

  // Add mounts if any
  if (containerInfo.mounts && containerInfo.mounts.length > 0) {
    let mountsList = "";
    containerInfo.mounts.slice(0, 3).forEach((mount) => {
      mountsList += `${mount.source} → ${mount.destination} (${mount.type}, ${
        mount.rw ? "rw" : "ro"
      })\n`;
    });

    if (containerInfo.mounts.length > 3) {
      mountsList += `... and ${containerInfo.mounts.length - 3} more mounts\n`;
    }

    if (mountsList) {
      embed.addFields({ name: "Mounts", value: mountsList, inline: false });
    }
  }

  return embed;
}

/**
 * Create a container logs embed
 * @param {string} containerId - Container ID or name
 * @param {string} containerName - Container name
 * @param {string} logs - Container logs
 * @returns {EmbedBuilder} Discord embed
 */
function createContainerLogsEmbed(containerId, containerName, logs) {
  const embed = new EmbedBuilder()
    .setColor("#2496ED") // Docker blue
    .setTitle(`Logs: ${containerName || containerId}`)
    .setTimestamp();

  // Process logs to make them suitable for Discord embeds
  const processedLogs = logs
    .split("\n")
    .slice(-20) // Get last 20 lines
    .map((line) => (line.length > 100 ? line.substring(0, 97) + "..." : line)) // Truncate long lines
    .join("\n");

  if (processedLogs.length > 0) {
    embed.setDescription("```\n" + processedLogs + "\n```");
  } else {
    embed.setDescription("No logs available");
  }

  return embed;
}

/**
 * Create an embed for Docker image list
 * @param {Array} images - List of Docker images from dockerMonitor.js
 * @returns {EmbedBuilder} Discord embed
 */
function createImageListEmbed(images) {
  const embed = new EmbedBuilder()
    .setColor("#2496ED") // Docker blue
    .setTitle("Docker Images")
    .setDescription(`Total images: ${images.length}`)
    .setTimestamp();

  if (images.length === 0) {
    embed.setDescription("No Docker images found.");
    return embed;
  }

  // Group images with multiple tags
  const groupedImages = {};

  images.forEach((image) => {
    const mainTag = image.repoTags[0];
    if (!groupedImages[mainTag]) {
      groupedImages[mainTag] = image;
    }
  });

  // Format the image list
  let imageList = "";
  let count = 0;

  Object.values(groupedImages).forEach((image) => {
    if (count < 15) {
      // Limit to 15 images to avoid embed limits
      const name =
        image.repoTags[0] !== "<none>:<none>"
          ? image.repoTags[0]
          : `<none> (${image.id})`;

      imageList += `**${count + 1}.** \`${name}\`\n`;
      imageList += `   ID: ${image.id} | Size: ${
        image.size
      } MB | Created: ${new Date(image.created).toLocaleDateString()}\n`;

      // Show additional tags if any
      if (image.repoTags.length > 1) {
        imageList += `   Also tagged as: ${image.repoTags
          .slice(1, 3)
          .map((tag) => `\`${tag}\``)
          .join(", ")}`;
        if (image.repoTags.length > 3) {
          imageList += ` and ${image.repoTags.length - 3} more`;
        }
        imageList += "\n";
      }

      imageList += "\n";
      count++;
    }
  });

  if (Object.keys(groupedImages).length > 15) {
    imageList += `... and ${
      Object.keys(groupedImages).length - 15
    } more images\n`;
  }

  embed.setDescription(imageList || "No image information available");
  return embed;
}

/**
 * Create an embed for Docker image pull status
 * @param {Object} pullResult - Result from pullImage function
 * @returns {EmbedBuilder} Discord embed
 */
function createImagePullEmbed(pullResult) {
  const embed = new EmbedBuilder()
    .setColor(pullResult.success ? "#2496ED" : "#FF0000") // Docker blue or red for error
    .setTitle(`Docker Image Pull: ${pullResult.image}`)
    .setTimestamp();

  if (pullResult.success) {
    embed.setDescription(
      `✅ Successfully pulled image \`${pullResult.image}\``
    );
  } else {
    embed.setDescription(`❌ Failed to pull image \`${pullResult.image}\``);

    // Add error details if available
    if (
      pullResult.progress &&
      pullResult.progress.errors &&
      pullResult.progress.errors.length > 0
    ) {
      embed.addFields({
        name: "Errors",
        value:
          pullResult.progress.errors.slice(0, 3).join("\n") || "Unknown error",
      });
    }
  }

  return embed;
}

/**
 * Create an embed for Docker Compose projects list
 * @param {Array} projects - List of Compose projects
 * @returns {EmbedBuilder} Discord embed
 */
function createComposeProjectsListEmbed(projects) {
  const embed = new EmbedBuilder()
    .setColor("#2496ED") // Docker blue
    .setTitle("Docker Compose Projects")
    .setDescription(`共發現 ${projects.length} 個 Compose 專案`)
    .setTimestamp();

  if (projects.length === 0) {
    embed.setDescription("未找到 Docker Compose 專案。");
    return embed;
  }

  let projectsList = "";
  projects.forEach((project, index) => {
    projectsList += `**${index + 1}.** \`${project.name}\`\n`;
    projectsList += `   💡 狀態: ${project.status}\n`;

    // 確保 configFiles 是一個數組
    if (project.configFiles) {
      const configFilesArray = Array.isArray(project.configFiles)
        ? project.configFiles
        : [project.configFiles];

      if (configFilesArray.length > 0 && configFilesArray[0]) {
        projectsList += `   📁 配置檔案: ${configFilesArray.join(", ")}\n`;
      }
    }

    if (project.workingDir) {
      projectsList += `   📂 工作目錄: ${project.workingDir}\n`;
    }
    projectsList += "\n";
  });

  embed.setDescription(projectsList || "無專案資訊可用");
  return embed;
}

/**
 * Create an embed for Docker Compose project details
 * @param {Object} project - Project details from dockerMonitor.js
 * @returns {EmbedBuilder} Discord embed
 */
function createComposeProjectDetailsEmbed(project) {
  const embed = new EmbedBuilder()
    .setColor("#2496ED") // Docker blue
    .setTitle(`Compose 專案: ${project.name}`)
    .setTimestamp();

  // 添加專案概述
  let overview = "";
  if (project.file) {
    overview += `📁 配置檔案: \`${project.file}\`\n`;
  }
  if (project.workingDir) {
    overview += `📂 工作目錄: \`${project.workingDir}\`\n`;
  }

  if (project.networks && project.networks.length > 0) {
    overview += `🔄 網路: ${project.networks
      .map((n) => `\`${n}\``)
      .join(", ")}\n`;
  }

  if (project.volumes && project.volumes.length > 0) {
    overview += `💾 存儲卷: ${project.volumes
      .map((v) => `\`${v}\``)
      .join(", ")}\n`;
  }

  embed.setDescription(overview);

  // 添加服務資訊
  if (project.services && project.services.length > 0) {
    // 按狀態分組
    const running = project.services.filter((s) => s.status === "running");
    const stopped = project.services.filter(
      (s) => s.status === "exited" || s.status === "stopped"
    );
    const others = project.services.filter(
      (s) =>
        s.status !== "running" &&
        s.status !== "exited" &&
        s.status !== "stopped"
    );

    // 運行中的服務
    if (running.length > 0) {
      let runningList = "";
      running.forEach((service, i) => {
        runningList += `**${i + 1}.** \`${service.name}\`\n`;
        runningList += `   📦 映像: ${service.image}\n`;
        if (service.health && service.health !== "N/A") {
          runningList += `   ❤️ 健康狀態: ${service.health}\n`;
        }
        if (service.ports && service.ports.length > 0) {
          runningList += `   🔌 端口: ${service.ports
            .map((p) =>
              typeof p === "string" ? p : `${p.published}:${p.target}`
            )
            .join(", ")}\n`;
        }
        if (service.depends_on && service.depends_on.length > 0) {
          runningList += `   🔗 依賴: ${
            Array.isArray(service.depends_on)
              ? service.depends_on.join(", ")
              : Object.keys(service.depends_on).join(", ")
          }\n`;
        }
        runningList += "\n";
      });

      embed.addFields({
        name: "✅ 運行中的服務",
        value: runningList,
        inline: false,
      });
    }

    // 已停止的服務
    if (stopped.length > 0) {
      let stoppedList = "";
      stopped.forEach((service, i) => {
        stoppedList += `**${i + 1}.** \`${service.name}\`\n`;
        stoppedList += `   📦 映像: ${service.image}\n`;
        stoppedList += `   🔄 狀態: ${service.status}\n`;
        stoppedList += "\n";
      });

      embed.addFields({
        name: "⛔ 已停止的服務",
        value: stoppedList,
        inline: false,
      });
    }

    // 其他狀態的服務
    if (others.length > 0) {
      let othersList = "";
      others.forEach((service, i) => {
        othersList += `**${i + 1}.** \`${service.name}\` (${service.status})\n`;
        othersList += `   📦 映像: ${service.image}\n`;
        othersList += "\n";
      });

      embed.addFields({
        name: "⚠️ 其他服務",
        value: othersList,
        inline: false,
      });
    }
  } else {
    embed.addFields({
      name: "服務",
      value: "此專案沒有定義服務。",
      inline: false,
    });
  }

  return embed;
}

/**
 * Create an embed for Docker Compose operation result
 * @param {Object} result - Operation result
 * @returns {EmbedBuilder} Discord embed
 */
function createComposeOperationResultEmbed(result) {
  const embed = new EmbedBuilder()
    .setColor(result.success ? "#2496ED" : "#FF0000") // Docker blue or red for error
    .setTitle(
      `Docker Compose ${result.action || "Operation"}: ${result.project}`
    )
    .setTimestamp();

  if (result.success) {
    embed.setDescription(
      `✅ 成功執行 \`${result.action || "operation"}\` 操作於專案 \`${
        result.project
      }\``
    );

    // 如果有輸出，顯示部分輸出（限制長度）
    if (result.output) {
      const limitedOutput =
        result.output.length > 1000
          ? result.output.substring(0, 997) + "..."
          : result.output;

      embed.addFields({
        name: "輸出日誌",
        value: "```\n" + limitedOutput + "\n```",
        inline: false,
      });
    }
  } else {
    embed.setDescription(
      `❌ 執行 \`${result.action || "operation"}\` 操作於專案 \`${
        result.project
      }\` 時出錯`
    );

    // 添加錯誤詳情
    if (result.error) {
      const limitedError =
        result.error.length > 1000
          ? result.error.substring(0, 997) + "..."
          : result.error;

      embed.addFields({
        name: "錯誤詳情",
        value: "```\n" + limitedError + "\n```",
        inline: false,
      });
    }
  }

  return embed;
}

/**
 * Create an embed for Docker Compose pull result
 * @param {Object} pullResult - Result from pullComposeImages function
 * @returns {EmbedBuilder} Discord embed
 */
function createComposePullResultEmbed(pullResult) {
  const embed = new EmbedBuilder()
    .setColor(pullResult.success ? "#2496ED" : "#FF0000") // Docker blue or red for error
    .setTitle(`Docker Compose Pull: ${pullResult.project}`)
    .setTimestamp();

  if (pullResult.success) {
    embed.setDescription(
      `✅ 成功拉取 Docker Compose 專案 \`${pullResult.project}\` 的映像`
    );

    // 如果有輸出，顯示部分輸出（限制長度）
    if (pullResult.output) {
      // 嘗試從輸出中提取哪些映像被拉取或更新
      const images = pullResult.output.match(/Pulling ([^\s]+)/g) || [];
      const pulledImages = [
        ...new Set(images.map((img) => img.replace("Pulling ", ""))),
      ];

      if (pulledImages.length > 0) {
        embed.addFields({
          name: "已拉取的映像",
          value: pulledImages.map((img) => `• \`${img}\``).join("\n"),
          inline: false,
        });
      }

      const limitedOutput =
        pullResult.output.length > 800
          ? pullResult.output.substring(0, 797) + "..."
          : pullResult.output;

      embed.addFields({
        name: "輸出日誌",
        value: "```\n" + limitedOutput + "\n```",
        inline: false,
      });
    }

    // 添加更新提示
    embed.addFields({
      name: "更新容器",
      value:
        "要讓容器使用新拉取的映像，你需要重啟或重建容器。\n" +
        "請使用 `/docker compose control` 命令並選擇 `restart` 或 `up` 操作。",
      inline: false,
    });
  } else {
    embed.setDescription(
      `❌ 拉取 Docker Compose 專案 \`${pullResult.project}\` 的映像時出錯`
    );

    // 添加錯誤詳情
    if (pullResult.error) {
      const limitedError =
        pullResult.error.length > 1000
          ? pullResult.error.substring(0, 997) + "..."
          : pullResult.error;

      embed.addFields({
        name: "錯誤詳情",
        value: "```\n" + limitedError + "\n```",
        inline: false,
      });
    }
  }

  return embed;
}

module.exports = {
  createSystemInfoEmbed,
  createNetworkInfoEmbed,
  createProcessListEmbed,
  createDockerInfoEmbed,
  createContainerListEmbed,
  createContainerDetailsEmbed,
  createContainerLogsEmbed,
  createImageListEmbed,
  createImagePullEmbed,
  // Docker Compose 相關
  createComposeProjectsListEmbed,
  createComposeProjectDetailsEmbed,
  createComposeOperationResultEmbed,
  createComposePullResultEmbed,
};

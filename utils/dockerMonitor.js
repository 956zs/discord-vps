const Docker = require("dockerode");
let docker;

try {
  // 嘗試默認連接方式
  docker = new Docker();

  // 測試連接
  docker.ping().catch((error) => {
    console.warn("Docker 連接失敗，可能是權限問題:", error.message);
    console.warn("請嘗試以下解決方案:");
    console.warn(
      "1. 將您的用戶添加到 docker 組: sudo usermod -aG docker $USER"
    );
    console.warn("2. 使用 sudo 運行應用程式");
    console.warn(
      "3. 臨時更改 docker.sock 權限: sudo chmod 666 /var/run/docker.sock"
    );
  });
} catch (error) {
  console.error("Docker 初始化失敗:", error);
  // 創建一個空的 Docker 實例，以確保不會有未定義錯誤
  docker = {
    listContainers: () => Promise.resolve([]),
    getContainer: () => ({
      inspect: () => Promise.reject(new Error("Docker 未連接")),
      stats: () => Promise.reject(new Error("Docker 未連接")),
      start: () => Promise.reject(new Error("Docker 未連接")),
      stop: () => Promise.reject(new Error("Docker 未連接")),
      restart: () => Promise.reject(new Error("Docker 未連接")),
      logs: () => Promise.reject(new Error("Docker 未連接")),
    }),
    info: () => Promise.reject(new Error("Docker 未連接")),
    version: () => Promise.reject(new Error("Docker 未連接")),
    df: () => Promise.reject(new Error("Docker 未連接")),
  };
}

/**
 * Get a list of all containers
 * @param {boolean} all - Whether to include stopped containers
 * @returns {Promise<Array>} List of containers
 */
async function listContainers(all = true) {
  try {
    const containers = await docker.listContainers({ all });

    return containers.map((container) => ({
      id: container.Id.substring(0, 12),
      names: container.Names.map((name) => name.replace(/^\//, "")),
      image: container.Image,
      state: container.State,
      status: container.Status,
      created: new Date(container.Created * 1000).toISOString(),
      ports: container.Ports.map((port) => ({
        ip: port.IP,
        privatePort: port.PrivatePort,
        publicPort: port.PublicPort,
        type: port.Type,
      })),
      network: container.NetworkSettings?.Networks
        ? Object.keys(container.NetworkSettings.Networks).map((key) => ({
            name: key,
            ip: container.NetworkSettings.Networks[key].IPAddress,
          }))
        : [],
    }));
  } catch (error) {
    console.error("Error listing containers:", error);
    throw error;
  }
}

/**
 * Get detailed information about a container
 * @param {string} containerId - ID or name of the container
 * @returns {Promise<Object>} Container details and stats
 */
async function getContainerInfo(containerId) {
  try {
    const container = docker.getContainer(containerId);
    const [info, stats] = await Promise.all([
      container.inspect(),
      container.stats({ stream: false }),
    ]);

    // Calculate CPU usage percentage
    const cpuDelta =
      stats.cpu_stats.cpu_usage.total_usage -
      stats.precpu_stats.cpu_usage.total_usage;
    const systemCpuDelta =
      stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpuCount =
      stats.cpu_stats.online_cpus ||
      stats.cpu_stats.cpu_usage.percpu_usage?.length ||
      1;

    let cpuPercent = 0;
    if (systemCpuDelta > 0 && cpuDelta > 0) {
      cpuPercent = (cpuDelta / systemCpuDelta) * cpuCount * 100;
    }

    // Calculate memory usage
    const memoryUsage = stats.memory_stats.usage;
    const memoryLimit = stats.memory_stats.limit;
    const memoryPercent = (memoryUsage / memoryLimit) * 100;

    // Calculate network usage
    const networks = stats.networks || {};
    const networkUsage = Object.keys(networks).reduce(
      (acc, interface) => {
        acc.rx_bytes += networks[interface].rx_bytes || 0;
        acc.tx_bytes += networks[interface].tx_bytes || 0;
        return acc;
      },
      { rx_bytes: 0, tx_bytes: 0 }
    );

    return {
      id: info.Id.substring(0, 12),
      name: info.Name.replace(/^\//, ""),
      image: info.Config.Image,
      created: new Date(info.Created).toISOString(),
      state: {
        status: info.State.Status,
        running: info.State.Running,
        paused: info.State.Paused,
        restarting: info.State.Restarting,
        startedAt: info.State.StartedAt,
        finishedAt: info.State.FinishedAt,
        exitCode: info.State.ExitCode,
        error: info.State.Error,
      },
      stats: {
        cpu: {
          usage: cpuPercent.toFixed(2),
        },
        memory: {
          usage: (memoryUsage / (1024 * 1024)).toFixed(2),
          limit: (memoryLimit / (1024 * 1024)).toFixed(2),
          percent: memoryPercent.toFixed(2),
        },
        network: {
          rx_bytes: (networkUsage.rx_bytes / (1024 * 1024)).toFixed(2),
          tx_bytes: (networkUsage.tx_bytes / (1024 * 1024)).toFixed(2),
        },
      },
      mounts: info.Mounts.map((mount) => ({
        type: mount.Type,
        source: mount.Source,
        destination: mount.Destination,
        mode: mount.Mode,
        rw: mount.RW,
      })),
      ports: Object.keys(info.NetworkSettings.Ports || {}).map((port) => {
        const hostConfig = info.NetworkSettings.Ports[port];
        return {
          containerPort: port,
          hostPorts: hostConfig
            ? hostConfig.map((binding) => ({
                hostIp: binding.HostIp,
                hostPort: binding.HostPort,
              }))
            : [],
        };
      }),
    };
  } catch (error) {
    console.error(`Error getting container info for ${containerId}:`, error);
    throw error;
  }
}

/**
 * Control a container (start, stop, restart)
 * @param {string} containerId - ID or name of the container
 * @param {string} action - Action to perform (start, stop, restart)
 * @returns {Promise<Object>} Result of the operation
 */
async function controlContainer(containerId, action) {
  try {
    const container = docker.getContainer(containerId);

    switch (action.toLowerCase()) {
      case "start":
        await container.start();
        break;
      case "stop":
        await container.stop();
        break;
      case "restart":
        await container.restart();
        break;
      default:
        throw new Error(`Invalid action: ${action}`);
    }

    const info = await container.inspect();

    return {
      id: info.Id.substring(0, 12),
      name: info.Name.replace(/^\//, ""),
      status: info.State.Status,
      action: action,
    };
  } catch (error) {
    console.error(
      `Error controlling container ${containerId} with action ${action}:`,
      error
    );
    throw error;
  }
}

/**
 * Get Docker system information
 * @returns {Promise<Object>} Docker system info and disk usage
 */
async function getDockerInfo() {
  try {
    const [info, version, diskUsage] = await Promise.all([
      docker.info(),
      docker.version(),
      docker.df(),
    ]);

    // Calculate total disk space used by Docker
    const imagesSize = diskUsage.Images.reduce(
      (total, image) => total + image.Size,
      0
    );
    const containersSize = diskUsage.Containers.reduce(
      (total, container) => total + container.SizeRw,
      0
    );
    const volumesSize = diskUsage.Volumes.reduce(
      (total, volume) => total + volume.UsageData.Size,
      0
    );

    return {
      version: {
        version: version.Version,
        apiVersion: version.ApiVersion,
        minApiVersion: version.MinAPIVersion,
        gitCommit: version.GitCommit,
        arch: version.Arch,
        buildTime: version.BuildTime,
        os: version.Os,
      },
      info: {
        containers: {
          total: info.Containers,
          running: info.ContainersRunning,
          paused: info.ContainersPaused,
          stopped: info.ContainersStopped,
        },
        images: info.Images,
        driver: info.Driver,
        memoryLimit: info.MemoryLimit,
        cpus: info.NCPU,
        kernelVersion: info.KernelVersion,
        operatingSystem: info.OperatingSystem,
      },
      diskUsage: {
        images: {
          count: diskUsage.Images.length,
          size: (imagesSize / (1024 * 1024 * 1024)).toFixed(2),
        },
        containers: {
          count: diskUsage.Containers.length,
          size: (containersSize / (1024 * 1024 * 1024)).toFixed(2),
        },
        volumes: {
          count: diskUsage.Volumes.length,
          size: (volumesSize / (1024 * 1024 * 1024)).toFixed(2),
        },
        total: (
          (imagesSize + containersSize + volumesSize) /
          (1024 * 1024 * 1024)
        ).toFixed(2),
      },
    };
  } catch (error) {
    console.error("Error getting Docker information:", error);
    throw error;
  }
}

/**
 * Get container logs
 * @param {string} containerId - ID or name of the container
 * @param {number} lines - Number of log lines to retrieve
 * @returns {Promise<string>} Container logs
 */
async function getContainerLogs(containerId, lines = 100) {
  try {
    const container = docker.getContainer(containerId);
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      tail: lines,
      timestamps: true,
    });

    // Convert Buffer to string and parse the log format
    return logs.toString("utf8");
  } catch (error) {
    console.error(`Error getting logs for container ${containerId}:`, error);
    throw error;
  }
}

module.exports = {
  listContainers,
  getContainerInfo,
  controlContainer,
  getDockerInfo,
  getContainerLogs,
};

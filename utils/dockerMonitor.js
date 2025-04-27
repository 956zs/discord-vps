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
 * @param {number|null} lines - Number of log lines to retrieve, null for all logs
 * @returns {Promise<string>} Container logs
 */
async function getContainerLogs(containerId, lines = 100) {
  try {
    const container = docker.getContainer(containerId);

    const options = {
      stdout: true,
      stderr: true,
      timestamps: true,
    };

    // If lines is not null, add tail option
    if (lines !== null) {
      options.tail = lines;
    }

    const logs = await container.logs(options);

    // Convert Buffer to string and parse the log format
    return logs.toString("utf8");
  } catch (error) {
    console.error(`Error getting logs for container ${containerId}:`, error);
    throw error;
  }
}

/**
 * Pull a Docker image from registry
 * @param {string} imageName - Name of the image to pull (e.g. "ubuntu:latest")
 * @returns {Promise<Object>} Result of the pull operation
 */
async function pullImage(imageName) {
  try {
    console.log(`Pulling Docker image: ${imageName}`);

    // Create a Promise to handle the Docker pull stream
    return new Promise((resolve, reject) => {
      docker.pull(imageName, (err, stream) => {
        if (err) {
          console.error(`Error initiating pull for ${imageName}:`, err);
          return reject(err);
        }

        // Track progress information
        let pullProgress = {
          status: "Pulling",
          details: {},
          errors: [],
        };

        // Process the stream data
        docker.modem.followProgress(
          stream,
          // Callback when pull is complete
          (err, output) => {
            if (err) {
              console.error(`Error pulling image ${imageName}:`, err);
              pullProgress.status = "Failed";
              pullProgress.errors.push(err.message);
              return reject(err);
            }

            console.log(`Successfully pulled image: ${imageName}`);
            pullProgress.status = "Complete";
            resolve({
              image: imageName,
              success: true,
              progress: pullProgress,
            });
          },
          // Progress callback
          (event) => {
            if (event.status) {
              // Update progress information
              const progressId = event.id || "unknown";
              pullProgress.details[progressId] = {
                status: event.status,
                progress: event.progress || "",
                details: event,
              };

              // Log progress for debugging
              if (event.progress) {
                console.log(
                  `${event.id || ""}: ${event.status} ${event.progress}`
                );
              }
            }

            // Handle error in the stream
            if (event.error) {
              pullProgress.errors.push(event.error);
              console.error(
                `Error in pull stream for ${imageName}:`,
                event.error
              );
            }
          }
        );
      });
    });
  } catch (error) {
    console.error(`Error pulling Docker image ${imageName}:`, error);
    throw error;
  }
}

/**
 * List all Docker images
 * @returns {Promise<Array>} List of images
 */
async function listImages() {
  try {
    const images = await docker.listImages();

    return images.map((image) => ({
      id: image.Id.replace("sha256:", "").substring(0, 12),
      repoTags: image.RepoTags || ["<none>:<none>"],
      created: new Date(image.Created * 1000).toISOString(),
      size: (image.Size / (1024 * 1024)).toFixed(2),
      virtualSize: (image.VirtualSize / (1024 * 1024)).toFixed(2),
    }));
  } catch (error) {
    console.error("Error listing images:", error);
    throw error;
  }
}

/**
 * List Docker Compose projects
 * @returns {Promise<Array>} List of Docker Compose projects
 */
async function listComposeProjects() {
  try {
    // 正確引入 util.promisify
    const util = require("util");
    const exec = util.promisify(require("child_process").exec);

    // 使用 docker compose ls 命令獲取所有 compose 項目
    const { stdout } = await exec("docker compose ls --format json");

    // 解析JSON輸出
    let projects = [];
    try {
      projects = JSON.parse(stdout);
    } catch (e) {
      // 如果JSON解析失敗，嘗試逐行解析
      projects = stdout
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch (e) {
            return null;
          }
        })
        .filter((item) => item !== null);
    }

    return projects.map((project) => ({
      name: project.Name,
      status: project.Status || "unknown",
      configFiles: project.ConfigFiles || [],
      workingDir: project.WorkingDir || "",
    }));
  } catch (error) {
    console.error("Error listing Docker Compose projects:", error);
    throw error;
  }
}

/**
 * Get details of a Docker Compose project
 * @param {string} projectName - Name of the Docker Compose project or directory path
 * @returns {Promise<Object>} Project details with services info
 */
async function getComposeProjectDetails(projectName) {
  try {
    // 正確引入 util.promisify
    const util = require("util");
    const exec = util.promisify(require("child_process").exec);
    const path = require("path");

    // 檢查是否為路徑
    const isPath = projectName.includes("/");

    // 設置工作目錄參數
    const workingDirArg = isPath
      ? `-f "${projectName}"`
      : `--project-name ${projectName}`;

    // 獲取項目配置
    const { stdout: configOutput } = await exec(
      `docker compose ${workingDirArg} config --format json`
    );

    // 解析配置
    let config = {};
    try {
      config = JSON.parse(configOutput);
    } catch (e) {
      throw new Error(`無法解析 Docker Compose 配置: ${e.message}`);
    }

    // 獲取服務狀態
    const { stdout: psOutput } = await exec(
      `docker compose ${workingDirArg} ps --format json`
    );

    // 解析服務狀態
    let services = [];
    try {
      services = JSON.parse(psOutput);
      // 處理可能的單行 JSON 輸出
      if (!Array.isArray(services)) {
        services = [services];
      }
    } catch (e) {
      // 嘗試逐行解析
      services = psOutput
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch (e) {
            return null;
          }
        })
        .filter((item) => item !== null);
    }

    // 將配置和狀態整合
    const projectServices = Object.keys(config.services || {}).map(
      (serviceName) => {
        const serviceConfig = config.services[serviceName];
        const serviceStatus = services.find(
          (s) => s.Service === serviceName || s.Name?.includes(serviceName)
        );

        return {
          name: serviceName,
          image: serviceConfig.image || "custom build",
          status: serviceStatus ? serviceStatus.State : "not created",
          health: serviceStatus ? serviceStatus.Health || "N/A" : "N/A",
          ports: serviceConfig.ports || [],
          depends_on: serviceConfig.depends_on || [],
        };
      }
    );

    return {
      name: isPath ? projectName : config.name || projectName,
      workingDir: isPath
        ? require("path").dirname(projectName)
        : config.workingDir || "",
      file: isPath
        ? require("path").basename(projectName)
        : "docker-compose.yml",
      services: projectServices,
      networks: Object.keys(config.networks || {}),
      volumes: Object.keys(config.volumes || {}),
    };
  } catch (error) {
    console.error(
      `Error getting Docker Compose project details for ${projectName}:`,
      error
    );
    throw error;
  }
}

/**
 * Pull images for a Docker Compose project
 * @param {string} projectNameOrPath - Project name or path to docker-compose.yml
 * @returns {Promise<Object>} Result of the pull operation
 */
async function pullComposeImages(projectNameOrPath) {
  try {
    // 導入必要的模組
    const child_process = require("child_process");

    // 檢查是否為路徑
    const isPath = projectNameOrPath.includes("/");

    // 設置工作目錄參數
    const workingDirArg = isPath
      ? `-f "${projectNameOrPath}"`
      : `--project-name ${projectNameOrPath}`;

    // 執行 pull 命令
    const childProcess = child_process.spawn(
      "docker",
      ["compose", ...workingDirArg.split(" "), "pull"],
      {
        shell: true,
      }
    );

    // 收集輸出
    let output = "";
    let errors = "";

    childProcess.stdout.on("data", (data) => {
      const chunk = data.toString();
      output += chunk;
      console.log(`[Compose Pull] ${chunk.trim()}`);
    });

    childProcess.stderr.on("data", (data) => {
      const chunk = data.toString();
      errors += chunk;
      console.error(`[Compose Pull Error] ${chunk.trim()}`);
    });

    // 返回結果
    return new Promise((resolve, reject) => {
      childProcess.on("close", (code) => {
        if (code === 0) {
          resolve({
            success: true,
            project: projectNameOrPath,
            output: output.trim(),
          });
        } else {
          resolve({
            success: false,
            project: projectNameOrPath,
            error: errors.trim() || `Process exited with code ${code}`,
          });
        }
      });

      childProcess.on("error", (err) => {
        reject(err);
      });
    });
  } catch (error) {
    console.error(
      `Error pulling Docker Compose images for ${projectNameOrPath}:`,
      error
    );
    throw error;
  }
}

/**
 * Control a Docker Compose project (up, down, restart)
 * @param {string} projectNameOrPath - Project name or path to docker-compose.yml
 * @param {string} action - Action to perform (up, down, restart)
 * @param {boolean} detached - Run in detached mode (for up)
 * @returns {Promise<Object>} Result of the operation
 */
async function controlComposeProject(
  projectNameOrPath,
  action,
  detached = true
) {
  try {
    // 導入必要的模組
    const child_process = require("child_process");

    // 檢查是否為路徑
    const isPath = projectNameOrPath.includes("/");

    // 設置工作目錄參數
    const workingDirArg = isPath
      ? `-f "${projectNameOrPath}"`
      : `--project-name ${projectNameOrPath}`;

    // 設置命令選項
    let command = ["compose"];
    command = command.concat(workingDirArg.split(" "));

    switch (action.toLowerCase()) {
      case "up":
        command.push("up");
        if (detached) {
          command.push("-d");
        }
        break;
      case "down":
        command.push("down");
        break;
      case "restart":
        command.push("restart");
        break;
      case "stop":
        command.push("stop");
        break;
      case "start":
        command.push("start");
        break;
      default:
        throw new Error(`無效的操作: ${action}`);
    }

    // 執行命令
    const childProcess = child_process.spawn("docker", command, {
      shell: true,
    });

    // 收集輸出
    let output = "";
    let errors = "";

    childProcess.stdout.on("data", (data) => {
      const chunk = data.toString();
      output += chunk;
      console.log(`[Compose ${action}] ${chunk.trim()}`);
    });

    childProcess.stderr.on("data", (data) => {
      const chunk = data.toString();
      errors += chunk;
      console.error(`[Compose ${action} Error] ${chunk.trim()}`);
    });

    // 返回結果
    return new Promise((resolve, reject) => {
      childProcess.on("close", (code) => {
        if (code === 0) {
          resolve({
            success: true,
            project: projectNameOrPath,
            action: action,
            output: output.trim(),
          });
        } else {
          resolve({
            success: false,
            project: projectNameOrPath,
            action: action,
            error: errors.trim() || `Process exited with code ${code}`,
          });
        }
      });

      childProcess.on("error", (err) => {
        reject(err);
      });
    });
  } catch (error) {
    console.error(
      `Error controlling Docker Compose project ${projectNameOrPath} with action ${action}:`,
      error
    );
    throw error;
  }
}

module.exports = {
  listContainers,
  getContainerInfo,
  controlContainer,
  getDockerInfo,
  getContainerLogs,
  pullImage,
  listImages,
  // Docker Compose 功能
  listComposeProjects,
  getComposeProjectDetails,
  pullComposeImages,
  controlComposeProject,
};

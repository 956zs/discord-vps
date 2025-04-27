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
    // 使用更簡單的方法獲取 Docker Compose 項目列表
    const child_process = require("child_process");

    return new Promise((resolve, reject) => {
      // 使用命令行獲取項目列表
      child_process.exec("docker compose ls", (error, stdout, stderr) => {
        if (error) {
          console.error("Error executing docker compose ls:", error);
          reject(error);
          return;
        }

        if (stderr) {
          console.warn("Warning from docker compose ls:", stderr);
        }

        // 解析命令行輸出
        const lines = stdout.trim().split("\n");
        if (lines.length <= 1) {
          // 只有標題行或沒有輸出
          resolve([]);
          return;
        }

        // 跳過標題行
        const projectLines = lines.slice(1);
        const projects = projectLines.map((line) => {
          const parts = line.trim().split(/\s{2,}/);
          // 通常格式是: NAME STATUS CONFIG FILES
          return {
            name: parts[0] || "unknown",
            status: parts[1] || "unknown",
            configFiles: parts[2] || "",
            workingDir: parts[3] || "",
          };
        });

        resolve(projects);
      });
    });
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
    const child_process = require("child_process");
    const path = require("path");
    const fs = require("fs");
    const os = require("os");

    // 檢查項目名稱或路徑是否有效
    if (!projectName || projectName.trim() === "") {
      throw new Error("未提供項目名稱或路徑");
    }

    // 檢查是否為絕對路徑或相對路徑
    const isPath = projectName.includes("/") || projectName.includes("\\");
    let composeFilePath = projectName;
    let fileExists = false;

    // 如果是路徑，驗證 docker-compose.yml 或 docker-compose.yaml 存在
    if (isPath) {
      // 檢查文件是否存在
      // 如果路徑不是以 .yml 或 .yaml 結尾，嘗試查找 docker-compose.yml 或 docker-compose.yaml
      if (!projectName.endsWith(".yml") && !projectName.endsWith(".yaml")) {
        const ymlPath = path.join(projectName, "docker-compose.yml");
        const yamlPath = path.join(projectName, "docker-compose.yaml");

        if (fs.existsSync(ymlPath)) {
          composeFilePath = ymlPath;
          fileExists = true;
        } else if (fs.existsSync(yamlPath)) {
          composeFilePath = yamlPath;
          fileExists = true;
        }
      } else {
        fileExists = fs.existsSync(projectName);
      }
    } else {
      // 如果不是路徑，先嘗試查找專案名稱的目錄
      // 1. 先檢查當前目錄下有沒有該名稱的資料夾
      const currentDirProject = path.join(process.cwd(), projectName);
      if (
        fs.existsSync(currentDirProject) &&
        fs.statSync(currentDirProject).isDirectory()
      ) {
        const ymlPath = path.join(currentDirProject, "docker-compose.yml");
        const yamlPath = path.join(currentDirProject, "docker-compose.yaml");

        if (fs.existsSync(ymlPath)) {
          composeFilePath = ymlPath;
          fileExists = true;
        } else if (fs.existsSync(yamlPath)) {
          composeFilePath = yamlPath;
          fileExists = true;
        }
      }

      // 2. 如果當前目錄下沒有，嘗試在用戶主目錄下查找
      if (!fileExists) {
        const homeDirProject = path.join(os.homedir(), projectName);
        if (
          fs.existsSync(homeDirProject) &&
          fs.statSync(homeDirProject).isDirectory()
        ) {
          const ymlPath = path.join(homeDirProject, "docker-compose.yml");
          const yamlPath = path.join(homeDirProject, "docker-compose.yaml");

          if (fs.existsSync(ymlPath)) {
            composeFilePath = ymlPath;
            fileExists = true;
          } else if (fs.existsSync(yamlPath)) {
            composeFilePath = yamlPath;
            fileExists = true;
          }
        }
      }
    }

    // 使用更直接的方式獲取項目詳情
    return new Promise((resolve, reject) => {
      // 設置工作目錄參數
      let workingDirArg;

      if (fileExists) {
        // 如果找到了文件，使用文件路徑
        console.log(`找到 Docker Compose 配置文件: ${composeFilePath}`);
        workingDirArg = `-f "${composeFilePath
          .replace(/\\/g, "/")
          .replace(/"/g, '\\"')}"`;
      } else {
        // 如果沒有找到文件，使用專案名稱
        console.log(`使用專案名稱: ${projectName}，未找到對應的配置文件`);
        workingDirArg = `--project-name ${projectName}`;
      }

      // 輸出完整命令用於調試
      console.log(
        `執行 Docker Compose 命令: docker compose ${workingDirArg} ps`
      );

      // 獲取服務列表
      child_process.exec(
        `docker compose ${workingDirArg} ps`,
        (error, stdout, stderr) => {
          if (error) {
            console.error(
              `Error executing docker compose ps for ${projectName}:`,
              error
            );
            reject(error);
            return;
          }

          if (stderr) {
            console.warn(
              `Warning from docker compose ps for ${projectName}:`,
              stderr
            );
          }

          // 解析服務狀態
          const lines = stdout.trim().split("\n");
          if (lines.length <= 1) {
            // 項目可能存在但沒有運行中的服務
            resolve({
              name: projectName,
              workingDir: isPath ? path.dirname(composeFilePath) : "",
              file: isPath
                ? path.basename(composeFilePath)
                : "docker-compose.yml",
              services: [],
              networks: [],
              volumes: [],
            });
            return;
          }

          // 解析服務信息
          const serviceLines = lines.slice(1); // 跳過標題行
          const services = serviceLines.map((line) => {
            const parts = line.trim().split(/\s{2,}/);
            // 格式通常是: NAME SERVICE STATUS PORTS
            return {
              name: parts[1] || parts[0] || "unknown",
              status: parts[2] || "unknown",
              health: parts[3] || "N/A",
              image: "N/A", // 這個信息在簡單模式下無法獲取
              ports: [],
              depends_on: [],
            };
          });

          // 嘗試獲取額外的網絡和卷信息
          child_process.exec(
            `docker compose ${workingDirArg} config --format json`,
            (error, stdout, stderr) => {
              let config = {};
              let networks = [];
              let volumes = [];

              if (!error && stdout) {
                try {
                  config = JSON.parse(stdout);

                  // 更新服務信息
                  if (config.services) {
                    Object.keys(config.services).forEach((serviceName) => {
                      const serviceConfig = config.services[serviceName];
                      const service = services.find(
                        (s) => s.name === serviceName
                      );

                      if (service) {
                        service.image = serviceConfig.image || "custom build";
                        service.ports = serviceConfig.ports || [];
                        service.depends_on = serviceConfig.depends_on || [];
                      }
                    });
                  }

                  // 獲取網絡和卷
                  networks = Object.keys(config.networks || {});
                  volumes = Object.keys(config.volumes || {});
                } catch (e) {
                  console.error(
                    `Error parsing Docker Compose config for ${projectName}:`,
                    e
                  );
                }
              }

              resolve({
                name: fileExists ? composeFilePath : config.name || projectName,
                workingDir: fileExists
                  ? path.dirname(composeFilePath)
                  : config.workingDir || "",
                file: fileExists
                  ? path.basename(composeFilePath)
                  : "docker-compose.yml",
                services: services,
                networks: networks,
                volumes: volumes,
              });
            }
          );
        }
      );
    });
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
    const fs = require("fs");
    const path = require("path");
    const os = require("os");

    // 檢查項目名稱或路徑是否有效
    if (!projectNameOrPath || projectNameOrPath.trim() === "") {
      throw new Error("未提供項目名稱或路徑");
    }

    // 檢查是否為絕對路徑或相對路徑
    const isPath =
      projectNameOrPath.includes("/") || projectNameOrPath.includes("\\");
    let composeFilePath = projectNameOrPath;
    let fileExists = false;

    // 如果是路徑，驗證 docker-compose.yml 或 docker-compose.yaml 存在
    if (isPath) {
      // 檢查文件是否存在
      // 如果路徑不是以 .yml 或 .yaml 結尾，嘗試查找 docker-compose.yml 或 docker-compose.yaml
      if (
        !projectNameOrPath.endsWith(".yml") &&
        !projectNameOrPath.endsWith(".yaml")
      ) {
        const ymlPath = path.join(projectNameOrPath, "docker-compose.yml");
        const yamlPath = path.join(projectNameOrPath, "docker-compose.yaml");

        if (fs.existsSync(ymlPath)) {
          composeFilePath = ymlPath;
          fileExists = true;
        } else if (fs.existsSync(yamlPath)) {
          composeFilePath = yamlPath;
          fileExists = true;
        }
      } else {
        fileExists = fs.existsSync(projectNameOrPath);
      }
    } else {
      // 如果不是路徑，先嘗試查找專案名稱的目錄
      // 1. 先檢查當前目錄下有沒有該名稱的資料夾
      const currentDirProject = path.join(process.cwd(), projectNameOrPath);
      if (
        fs.existsSync(currentDirProject) &&
        fs.statSync(currentDirProject).isDirectory()
      ) {
        const ymlPath = path.join(currentDirProject, "docker-compose.yml");
        const yamlPath = path.join(currentDirProject, "docker-compose.yaml");

        if (fs.existsSync(ymlPath)) {
          composeFilePath = ymlPath;
          fileExists = true;
        } else if (fs.existsSync(yamlPath)) {
          composeFilePath = yamlPath;
          fileExists = true;
        }
      }

      // 2. 如果當前目錄下沒有，嘗試在用戶主目錄下查找
      if (!fileExists) {
        const homeDirProject = path.join(os.homedir(), projectNameOrPath);
        if (
          fs.existsSync(homeDirProject) &&
          fs.statSync(homeDirProject).isDirectory()
        ) {
          const ymlPath = path.join(homeDirProject, "docker-compose.yml");
          const yamlPath = path.join(homeDirProject, "docker-compose.yaml");

          if (fs.existsSync(ymlPath)) {
            composeFilePath = ymlPath;
            fileExists = true;
          } else if (fs.existsSync(yamlPath)) {
            composeFilePath = yamlPath;
            fileExists = true;
          }
        }
      }
    }

    // 設置工作目錄參數和命令
    let command = ["compose"];
    let workingDirArg;

    if (fileExists) {
      // 如果找到了文件，使用文件路徑
      console.log(`找到 Docker Compose 配置文件: ${composeFilePath}`);
      workingDirArg = `-f "${composeFilePath
        .replace(/\\/g, "/")
        .replace(/"/g, '\\"')}"`;
      command = command.concat(workingDirArg.split(" "));
    } else {
      // 如果沒有找到文件，使用專案名稱
      console.log(`使用專案名稱: ${projectNameOrPath}，未找到對應的配置文件`);
      workingDirArg = `--project-name ${projectNameOrPath}`;
      command = command.concat(workingDirArg.split(" "));
    }

    // 添加pull命令
    command.push("pull");

    // 輸出完整命令用於調試
    console.log(`執行 Docker Compose 命令: docker ${command.join(" ")}`);

    // 執行 pull 命令
    const childProcess = child_process.spawn("docker", command, {
      shell: true,
    });

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
            project: composeFilePath,
            output: output.trim(),
          });
        } else {
          resolve({
            success: false,
            project: composeFilePath,
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
    const fs = require("fs");
    const path = require("path");
    const os = require("os");

    // 檢查項目名稱或路徑是否有效
    if (!projectNameOrPath || projectNameOrPath.trim() === "") {
      throw new Error("未提供項目名稱或路徑");
    }

    // 檢查是否為絕對路徑或相對路徑
    const isPath =
      projectNameOrPath.includes("/") || projectNameOrPath.includes("\\");
    let composeFilePath = projectNameOrPath;
    let fileExists = false;

    // 如果是路徑，驗證 docker-compose.yml 或 docker-compose.yaml 存在
    if (isPath) {
      // 檢查文件是否存在
      // 如果路徑不是以 .yml 或 .yaml 結尾，嘗試查找 docker-compose.yml 或 docker-compose.yaml
      if (
        !projectNameOrPath.endsWith(".yml") &&
        !projectNameOrPath.endsWith(".yaml")
      ) {
        const ymlPath = path.join(projectNameOrPath, "docker-compose.yml");
        const yamlPath = path.join(projectNameOrPath, "docker-compose.yaml");

        if (fs.existsSync(ymlPath)) {
          composeFilePath = ymlPath;
          fileExists = true;
        } else if (fs.existsSync(yamlPath)) {
          composeFilePath = yamlPath;
          fileExists = true;
        }
      } else {
        fileExists = fs.existsSync(projectNameOrPath);
      }
    } else {
      // 如果不是路徑，先嘗試查找專案名稱的目錄
      // 1. 先檢查當前目錄下有沒有該名稱的資料夾
      const currentDirProject = path.join(process.cwd(), projectNameOrPath);
      if (
        fs.existsSync(currentDirProject) &&
        fs.statSync(currentDirProject).isDirectory()
      ) {
        const ymlPath = path.join(currentDirProject, "docker-compose.yml");
        const yamlPath = path.join(currentDirProject, "docker-compose.yaml");

        if (fs.existsSync(ymlPath)) {
          composeFilePath = ymlPath;
          fileExists = true;
        } else if (fs.existsSync(yamlPath)) {
          composeFilePath = yamlPath;
          fileExists = true;
        }
      }

      // 2. 如果當前目錄下沒有，嘗試在用戶主目錄下查找
      if (!fileExists) {
        const homeDirProject = path.join(os.homedir(), projectNameOrPath);
        if (
          fs.existsSync(homeDirProject) &&
          fs.statSync(homeDirProject).isDirectory()
        ) {
          const ymlPath = path.join(homeDirProject, "docker-compose.yml");
          const yamlPath = path.join(homeDirProject, "docker-compose.yaml");

          if (fs.existsSync(ymlPath)) {
            composeFilePath = ymlPath;
            fileExists = true;
          } else if (fs.existsSync(yamlPath)) {
            composeFilePath = yamlPath;
            fileExists = true;
          }
        }
      }
    }

    // 設置工作目錄參數和命令
    let command = ["compose"];
    let workingDirArg;

    if (fileExists) {
      // 如果找到了文件，使用文件路徑
      console.log(`找到 Docker Compose 配置文件: ${composeFilePath}`);
      workingDirArg = `-f "${composeFilePath
        .replace(/\\/g, "/")
        .replace(/"/g, '\\"')}"`;
      command = command.concat(workingDirArg.split(" "));
    } else {
      // 如果沒有找到文件，使用專案名稱
      console.log(`使用專案名稱: ${projectNameOrPath}，未找到對應的配置文件`);
      workingDirArg = `--project-name ${projectNameOrPath}`;
      command = command.concat(workingDirArg.split(" "));
    }

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

    // 輸出完整命令用於調試
    console.log(`執行 Docker Compose 命令: docker ${command.join(" ")}`);

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
            project: composeFilePath,
            action: action,
            output: output.trim(),
          });
        } else {
          resolve({
            success: false,
            project: composeFilePath,
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

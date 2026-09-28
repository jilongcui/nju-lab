# njuserver 存储扩容与主机资源实测（2026-09-28）

> **本文回答一个问题**：这台 16C/32G 的机器（njuserver）能否承载「平台侧实验工作台」。
> 结论：**能，但只有 Docker 一条路**（该机不支持嵌套虚拟化），且扩容前磁盘是硬瓶颈。
> 本文记录扩容操作、验收、回滚，以及支撑该结论的主机资源实测数据。
>
> 关联：`HANDOFF.md` §0 / §2.1 · `nju-lab-craft.md`

---

## 1. 背景与风险

评估「学院智能体实验」的承载能力时，实测发现根分区 **49G 已用 38G、仅剩 9G（81%）**。

这不是"余量不足"的问题，而是一个**生产风险**：该机同时跑着生产的 MySQL 与 nju-lab 后端，
根分区一旦被 session 日志或容器写入填满，会连带把生产库一起搞挂。**扩容的优先级高于任何新功能。**

---

## 2. 主机资源实测（2026-09-28）

### 2.1 扩容前 → 扩容后

| 项 | 扩容前 | 扩容后 |
|---|---|---|
| 根分区 | 49G，已用 38G，**可用 9G** | 98G，已用 34G，**可用 60G** |
| `/data` | —— | **957G，可用 947G** |
| LVM VG 余量 | 0 | 51.2G（留给快照/再分配） |
| 合计可用存储 | **9G** | **1007G** |

### 2.2 关键约束（实测，非估算）

| 项 | 实测结果 | 对方案的影响 |
|---|---|---|
| 嵌套虚拟化 | **无 `/dev/kvm`、无 kvm 模块** | ❌ **KVM 虚拟机不可行**；QEMU 纯软件模拟慢 10–50 倍，同样不可用 → 「每人一台 VM」方案排除 |
| CPU 特性 | 只有 `fpu sse sse2 ht`，**无 SSE4.2 / POPCNT / AVX** | ⚠️ native 模块（sharp 等）易崩，见 `HANDOFF.md` §2.1 注意③；容器内跑同样受限 |
| CPU 规格 | 16 vCPU (QEMU) | ✅ 智能体实验是"等 LLM 返回"的 IO 型负载，**实测 dsh 运行期 CPU 0.00%** |
| 内存 | 31G，available 28G | ✅ 见下方 dify 占用 |
| 单容器开销 | 空 `node:22-slim` 容器 **7.4MB**；dsh 完整加载 profile+插件并发起会话 **峰值 RSS 128MB** | ✅ 512MB/人限额安全 |
| 内存占用大户 | `docker-sandbox-1`（dify 遗留）独占 **8.18G**，`--memory 0` + `restart=always` | ⚠️ 内存侧唯一会突然挤爆的隐患 |

### 2.3 磁盘去向（扩容前 38G 的构成，供后续清理参考）

| 目录 | 占用 | 性质 |
|---|---|---|
| `/home/ubuntu/dify` | 8.5G | ⚠️ 别的项目（dify 数据卷 + 备份），容器仍在运行 |
| `/home/ubuntu/foxcms` + `.tar.gz` | 2.7G | ⚠️ 别的项目 |
| `/var/log`（journal） | 4.0G | ✅ 可 `journalctl --vacuum-size=500M` |
| `/swap.img` | 3.8G | swap 文件 |
| `/home/ubuntu/.cache`/`.npm`/`.rustup`/`.cargo`/`.nvm`/`.pyenv` | ~7G | 工具链与缓存 |
| `/usr` | 5.2G | 系统 |

> `dify` 与 `foxcms` **不是本项目的资产**，处置前必须确认学院无人使用。

### 2.4 容量推算（30 人以内、本地为主 + 平台兜底）

| 资源 | 需求（按峰值 15 人上云） | 供给 | 结论 |
|---|---|---|---|
| 内存 | 15 × 512MB + 平台 2G + 复验并发 2G ≈ 11.5G | 28G available | ✅ 充裕 |
| CPU | 15 × 0.5 核 = 7.5 核 | 16 核 | ✅ 充裕（`--cpus` 是上限非预留，可超卖） |
| 磁盘 | ~20G（工作区 + 镜像 + 日志余量） | 1007G | ✅ 余量几十倍 |

复验容器的现有限额可作参考：`VERIFY_DOCKER_MEMORY=1g`、`VERIFY_DOCKER_CPUS=1`
（`server/src/submissions/docker-evaluation-runner.ts`）。

---

## 3. 扩容操作

> ⚠️ 本机 `ubuntu` 的 `sudo` 需要密码；以下命令均需 `sudo` 执行。
> 全部为**新增操作**（sda 是空盘，不动现有 LV），无数据风险。

### 3.1 根分区扩容（49G → 98G）

把 `vda3`（99G PV）中一直未分配的 ~49.5G 并入根 LV：

```bash
sudo lvextend -l +100%FREE /dev/ubuntu-vg/ubuntu-lv
sudo resize2fs /dev/ubuntu-vg/ubuntu-lv
df -h /          # 49G → 98G
```

### 3.2 新增 `/data` 数据盘（1T 裸盘 `sda`）

`sda` 是一块 1TB 的 `QEMU HARDDISK`，**无分区表、无文件系统**（`fdisk` 确认
`Device does not contain a recognized partition table`），可直接使用。

```bash
# ① 确认盘上没有残留签名（只读，不擦除）
sudo wipefs /dev/sda

# ② 整盘做 PV 加入 VG（不分区，LVM 标准做法）
sudo pvcreate /dev/sda
sudo vgextend ubuntu-vg /dev/sda
sudo vgs                      # VFree ≈ 1.09t

# ③ 建 LV 并格式化
sudo lvcreate -n lab-data -l 95%FREE ubuntu-vg
sudo mkfs.ext4 -m 1 -L lab-data /dev/ubuntu-vg/lab-data

# ④ 挂载
sudo mkdir -p /data
sudo mount /dev/ubuntu-vg/lab-data /data
sudo blkid /dev/ubuntu-vg/lab-data     # 取 UUID
```

两个参数是刻意选的，**换机器重现时别漏**：

- **`-l 95%FREE` 而非 `100%FREE`**：语义是「VG 剩余空间的 95%」。留 5%（51.2G）是为了
  保留 VG 余量——**LVM 快照需要 VG 里有 free 空间**，全占满就做不了快照。
- **`mkfs.ext4 -m 1`**：ext4 默认给 root 保留 **5%**，在这块 972.79g 的 LV 上就是 ~48G 白放着。
  数据盘改成 1% 即可，**实测省下约 39G**。

### 3.3 写入 fstab

```bash
echo 'UUID=<blkid 拿到的 UUID> /data ext4 defaults,nofail 0 2' | sudo tee -a /etc/fstab

# 必须验证（写错会开不了机）
sudo umount /data && sudo mount -a && df -h /data
```

- 用 **UUID** 而非设备路径（设备名可能变）。fstab 里根分区自己用的也是
  `/dev/disk/by-id/dm-uuid-LVM-...` 形式。
- **`nofail` 不能省**：万一 `/data` 那块盘出问题，系统不会卡在启动阶段。
- 末位 `2` = fsck 二顺位（根是 `0`、`/boot` 是 `0`，数据盘排在后面检查）。

---

## 4. 验收

```bash
sudo vgs
sudo lvs
lsblk -f | grep -A2 sda
df -h / /data
```

实际输出（2026-09-28）：

```
VG        #PV #LV #SN Attr   VSize  VFree
ubuntu-vg   2   2   0 wz--n- <1.10t 51.20g

LV        VG        Attr       LSize
lab-data  ubuntu-vg -wi-ao---- 972.79g
ubuntu-lv ubuntu-vg -wi-ao---- <99.00g

/dev/mapper/ubuntu--vg-ubuntu--lv   98G   34G   60G  37% /
/dev/mapper/ubuntu--vg-lab--data   957G   28K  947G   1% /data
```

> `/data` 显示 957G 而非 972.79g：差值 15G 是 ext4 元数据开销。
> `Avail` 947G 已扣除 1% 保留块（~9.7G）——若用默认 `-m 5`，这里会只剩 ~908G。

---

## 5. 回滚

`/data` 上没有业务数据时，回滚很轻：

```bash
sudo umount /data
sudo sed -i '\#/data#d' /etc/fstab        # 删掉 /data 那行
sudo lvremove /dev/ubuntu-vg/lab-data     # 删 LV
sudo vgreduce ubuntu-vg /dev/sda          # 退出 VG
sudo pvremove /dev/sda                    # 清 LVM 标签
```

⚠️ **根分区扩容不可逆**（LV 可以缩，但 ext4 在线缩小风险高）。本机根分区已扩到 98G，
不需要回滚。

---

## 6. 遗留项与后续

1. **`docker-sandbox-1` 无限额 + `restart=always`**（占 8.18G 内存）：建议至少加 `--memory` 限额；
   若学院确认无人使用 dify，停掉可回收 ~8.5G 内存 + 8.5G 磁盘。**处置前须确认无其他使用者。**
2. **journald 未限容**（曾涨到 4.0G）：建议在 `/etc/systemd/journald.conf` 设
   `SystemMaxUse=500M` 防复发。
3. **`/data` 目录结构未建**：学生工作区怎么放属于「实验工作台」设计的一部分，
   等方案定了再建，避免先建了又要改。
4. **工作台的机器边界**：容器与生产 MySQL 同机，而学生跑的是 LLM 生成的代码。
   即便只做 15 人兜底，**逃逸风险不因人数少而降低**。建议把"工作台跑在哪台机器"做成可配置，
   别把容器编排硬写死在本机。

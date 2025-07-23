# Deno Gitea API 服务

这是一个使用 [Deno](https://deno.com/) 构建的、零第三方依赖（除官方标准库外）的轻量级 HTTP 服务。它作为 Gitea API
的一个代理层，提供了一系列简洁的接口来操作 Gitea 仓库中的 Issue。

## ✨ 功能特性

- ✅ 获取认证用户的 Gitea 仓库列表
- ✅ 获取指定仓库的 Issue 列表（支持按状态筛选 `open`, `closed`, `all`）
- ✅ 获取指定仓库中单个 Issue 的**详细信息**（包括内容、标签、指派人等）
- ✅ 在指定仓库中创建新的 Issue
- ✅ 获取指定 Issue 的**完整时间线**（包括评论、提交引用、状态变更等事件）

## 🚀 开始使用

### 1. 先决条件

- 已安装 [Deno](https://deno.com/manual@v1.x/getting_started/installation) (v1.x or higher)。
- 拥有一个 Gitea 实例的访问权限。
- 在 Gitea 中生成一个有 `repository` 读写权限的个人访问令牌 (Access Token)。
  - (路径: Gitea -> 设置 -> 应用 -> 生成新令牌)

### 2. 配置

本服务支持通过 `.env` 文件或系统环境变量进行配置。

**优先级规则：系统环境变量 > `.env` 文件**

这意味着如果同一个变量在两处都设置了，程序将优先使用系统环境变量的值。

**选项一：使用 `.env` 文件 (推荐)**

在项目根目录下创建一个 `.env` 文件，内容如下：

```ini
# .env

# 你的 Gitea 实例 URL
GITEA_URL="https://gitea.example.com"

# 你的 Gitea 个人访问令牌
GITEA_TOKEN="your_personal_access_token_xxxxxxxx"
```

**重要提示:** 请将 `.env` 文件添加到你的 `.gitignore` 中，以防敏感信息泄露。

**选项二：使用环境变量**

在终端中直接设置环境变量：

```bash
export GITEA_URL="https://gitea.example.com"
export GITEA_TOKEN="your_personal_access_token_xxxxxxxx"
```

### 3. 运行服务

在项目根目录下，执行以下命令：

```bash
deno run --allow-read --allow-env --allow-net main.ts
```

- `--allow-net`: 允许网络访问（启动服务和请求 Gitea API）。
- `--allow-env`: 允许读取环境变量。
- `--allow-read`: 允许读取 `.env` 文件。

服务启动后，你将看到提示：`Gitea API 服务正在启动，监听 http://localhost:8000`

## 📚 API 端点使用说明

以下所有示例中，请将 `myuser` 替换为你的 Gitea 用户名，将 `my-awesome-project` 替换为你的仓库名。

---

### 1. 获取仓库列表

- **GET** `/repos`
- **示例:** `curl http://localhost:8000/repos`

---

### 2. 获取仓库的 Issue 列表

- **GET** `/repos/:owner/:repo/issues`
- **查询参数:** `state` (可选, 值: `open`, `closed`, `all`, 默认为 `open`)
- **示例 (获取所有状态的 Issue):** `curl "http://localhost:8000/repos/myuser/my-awesome-project/issues?state=all"`

---

### 3. 获取单个 Issue 的详细信息

- **GET** `/repos/:owner/:repo/issues/:index`
- **描述:** 获取单个 Issue 的详细信息，包括其内容、标签和指派人。

**示例:**

```bash
curl http://localhost:8000/repos/myuser/my-awesome-project/issues/12
```

**响应:**

```json
{
  "issue_number": 12,
  "title": "修复登录页面的 Bug",
  "state": "closed",
  "body": "用户在输入错误的密码后，页面会卡死，需要修复。",
  "labels": [
    {
      "name": "bug",
      "color": "d73a4a",
      "description": "Something isn't working"
    }
  ],
  "assignees": [
    "John Doe"
  ]
}
```

---

### 4. 创建一个 Issue

- **POST** `/repos/:owner/:repo/issues`
- **请求体:** JSON 对象，`title` 字段为必须。

**示例:**

```bash
curl -X POST \
  http://localhost:8000/repos/myuser/my-awesome-project/issues \
  -H "Content-Type: application/json" \
  -d '{
    "title": "新功能：用户头像上传",
    "body": "希望用户可以自定义他们的头像。"
  }'
```

---

### 5. 获取 Issue 的时间线

- **GET** `/repos/:owner/:repo/issues/:index/timeline`
- **描述:** 获取 Issue 从创建到现在的完整活动记录。

**示例:**

```bash
curl http://localhost:8000/repos/myuser/my-awesome-project/issues/12/timeline
```

**响应:**

```json
[
  {
    "type": "comment",
    "user": "another_user",
    "content": "我确认可以复现这个问题。",
    "created_at": "2023-10-27T10:30:00Z"
  },
  {
    "type": "assignees",
    "user": "myuser",
    "content": "将任务指派给: JohnDoe",
    "created_at": "2023-10-27T11:00:00Z"
  },
  {
    "type": "closed",
    "user": "JohnDoe",
    "content": "关闭了此 Issue",
    "created_at": "2023-10-28T15:01:00Z"
  }
]
```

## 📂 项目结构

```
.
├── .env         # 存储配置变量 (需手动创建)
├── main.ts      # Deno 服务主文件
└── README.md    # 本文档
```

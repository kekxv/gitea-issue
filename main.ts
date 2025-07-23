// main.ts

/**
 * =======================================================
 *               Deno Gitea API 服务
 * =======================================================
 *
 * 功能:
 * 1. 获取认证用户的仓库列表
 * 2. 获取指定仓库的 Issue 列表 (支持 ?state=... & filter=mine 查询)
 * 3. 获取指定仓库中单个 Issue 的详细信息 (包括标签、指派人等)
 * 4. 在指定仓库中创建新的 Issue
 * 5. 获取指定 Issue 的完整时间线 (评论、提交引用、状态变更等)
 *
 * 配置:
 * - 支持 .env 文件和系统环境变量
 * - 优先级: 系统环境变量 > .env 文件
 */

import {STATUS_CODE} from "https://deno.land/std@0.224.0/http/status.ts";
import {load} from "https://deno.land/std@0.224.0/dotenv/mod.ts";

// --- 1. CONFIGURATION & INITIALIZATION ---
const envFromFile = await load();
const GITEA_URL = Deno.env.get("GITEA_URL") || envFromFile["GITEA_URL"];
const GITEA_TOKEN = Deno.env.get("GITEA_TOKEN") || envFromFile["GITEA_TOKEN"];

let currentGiteaUser: string | null = null;

/**
 * Initializes the service by fetching the current authenticated user's info.
 * Exits if configuration is missing or token is invalid.
 */
async function initialize() {
  if (!GITEA_URL || !GITEA_TOKEN) {
    console.error("错误: 必须通过 .env 文件或系统环境变量设置 GITEA_URL 和 GITEA_TOKEN。");
    Deno.exit(1);
  }

  try {
    console.log("正在获取 Gitea 认证用户信息...");
    const user = await giteaApiRequest("/user", "GET");
    currentGiteaUser = user.login;
    console.log(`认证成功，当前用户: ${currentGiteaUser}`);
  } catch (error) {
    console.error("错误: 无法获取 Gitea 用户信息，请检查 GITEA_URL 和 GITEA_TOKEN 是否正确。", error.message);
    Deno.exit(1);
  }
}

// --- 2. GITEA API CLIENT & HELPERS ---

/**
 * Creates a standardized JSON error response.
 * @param message The error message.
 * @param status The HTTP status code.
 * @returns A Response object with a JSON body.
 */
function jsonErrorResponse(message: string, status: number): Response {
  return Response.json({error: message}, {status});
}


/**
 * A generic fetch client for the Gitea API.
 * @param path The API path (e.g., /user/repos)
 * @param method The HTTP method
 * @param body The request body for POST/PUT requests
 * @returns A promise that resolves to the parsed JSON response
 */
async function giteaApiRequest(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  body?: unknown,
) {
  const url = `${GITEA_URL}/api/v1${path}`;
  const headers = {
    "Authorization": `token ${GITEA_TOKEN}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    // Prepend the status to the error message for better context in logs
    let errorMessage = `Gitea API Error: ${response.status} ${response.statusText}`;
    try {
      // If Gitea returns a JSON error, include its message
      const errorJson = JSON.parse(errorText);
      if (errorJson.message) {
        errorMessage += ` - ${errorJson.message}`;
      }
    } catch {
      // Otherwise, use the raw text
      errorMessage += ` - ${errorText}`;
    }
    throw new Error(errorMessage, {cause: response.status});
  }

  if (response.status === STATUS_CODE.NoContent) {
    return null;
  }

  return await response.json();
}

// --- 3. ROUTE HANDLERS ---

/** Handler: Get a list of repositories for the authenticated user. */
async function handleGetRepos(_req: Request, _match: URLPatternResult): Promise<Response> {
  try {
    const repos = await giteaApiRequest("/user/repos", "GET");
    const simplifiedRepos = repos.map((repo: any) => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      description: repo.description,
      html_url: repo.html_url,
      private: repo.private,
    }));
    return Response.json(simplifiedRepos);
  } catch (error) {
    console.error("获取仓库列表失败:", error);
    return jsonErrorResponse("无法从 Gitea 获取仓库列表", STATUS_CODE.InternalServerError);
  }
}

/** Handler: Get a list of issues for a repository, with optional state and user-related filtering. */
async function handleListIssues(req: Request, match: URLPatternResult): Promise<Response> {
  const {owner, repo} = match.pathname.groups;
  if (!owner || !repo) {
    return jsonErrorResponse("请求路径参数不完整", STATUS_CODE.BadRequest);
  }

  const url = new URL(req.url);
  const state = url.searchParams.get("state") || "all";
  const filter = url.searchParams.get("filter");

  try {
    let issues = [];
    if (!filter || filter === 'mine') {
      if (!currentGiteaUser) {
        return jsonErrorResponse("服务未正确初始化，无法获取用户信息。", STATUS_CODE.ServiceUnavailable);
      }
      const [assignedIssues, createdIssues] = await Promise.all([
        giteaApiRequest(`/repos/${owner}/${repo}/issues?state=${state}&assignee=${currentGiteaUser}`, "GET"),
        giteaApiRequest(`/repos/${owner}/${repo}/issues?state=${state}&created_by=${currentGiteaUser}`, "GET")
      ]);
      const issueMap = new Map();
      [...assignedIssues, ...createdIssues].forEach((issue: any) => {
        issueMap.set(issue.id, issue);
      });
      issues = Array.from(issueMap.values());
    } else {
      issues = await giteaApiRequest(`/repos/${owner}/${repo}/issues?state=${state}`, "GET");
    }

    const simplifiedIssues = issues.map((issue: any) => ({
      number: issue.number,
      title: issue.title,
      state: issue.state,
      user: issue.user.login,
      assignees: (issue.assignees || []).map((a: any) => a.login),
      html_url: issue.html_url,
      created_at: issue.created_at,
    }));
    return Response.json(simplifiedIssues);
  } catch (error) {
    console.error(`获取 ${owner}/${repo} 的 Issue 列表失败:`, error);
    return jsonErrorResponse("无法从 Gitea 获取 Issue 列表", STATUS_CODE.InternalServerError);
  }
}

/** Handler: Get detailed information for a single issue. */
async function handleGetIssueDetails(_req: Request, match: URLPatternResult): Promise<Response> {
  const {owner, repo, index} = match.pathname.groups;
  if (!owner || !repo || !index) {
    return jsonErrorResponse("请求路径参数不完整", STATUS_CODE.BadRequest);
  }

  try {
    const issue = await giteaApiRequest(`/repos/${owner}/${repo}/issues/${index}`, "GET");
    return Response.json({
      issue_number: issue.number,
      title: issue.title,
      state: issue.state,
      body: issue.body,
      labels: (issue.labels || []).map((label: any) => ({
        name: label.name,
        color: label.color,
        description: label.description,
      })),
      assignees: (issue.assignees || []).map(
        (assignee: any) => assignee.full_name || assignee.login,
      ),
    });
  } catch (error) {
    console.error(`获取 Issue #${index} 状态失败:`, error);
    if (error.cause === STATUS_CODE.NotFound) {
      return jsonErrorResponse(`在 ${owner}/${repo} 中未找到 Issue #${index}`, STATUS_CODE.NotFound);
    }
    return jsonErrorResponse("无法从 Gitea 获取 Issue 状态", STATUS_CODE.InternalServerError);
  }
}

/** Handler: Create a new issue in a repository. */
async function handleCreateIssue(req: Request, match: URLPatternResult): Promise<Response> {
  const {owner, repo} = match.pathname.groups;
  if (!owner || !repo) {
    return jsonErrorResponse("请求路径参数不完整", STATUS_CODE.BadRequest);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonErrorResponse("无效的 JSON 请求体", STATUS_CODE.BadRequest);
  }

  if (!body.title || typeof body.title !== "string" || body.title.trim() === "") {
    return jsonErrorResponse('请求体必须包含一个非空的 "title" 字符串', STATUS_CODE.UnprocessableEntity); // 422 is more specific here
  }

  try {
    const newIssuePayload = {title: body.title, body: body.body || ""};
    const createdIssue = await giteaApiRequest(`/repos/${owner}/${repo}/issues`, "POST", newIssuePayload);
    return Response.json(createdIssue, {status: STATUS_CODE.Created});
  } catch (error) {
    console.error("创建 Issue 失败:", error);
    return jsonErrorResponse("无法在 Gitea 中创建 Issue", STATUS_CODE.InternalServerError);
  }
}

/** Handler: Get the complete timeline for an issue. */
async function handleGetIssueTimeline(_req: Request, match: URLPatternResult): Promise<Response> {
  const {owner, repo, index} = match.pathname.groups;
  if (!owner || !repo || !index) {
    return jsonErrorResponse("请求路径参数不完整", STATUS_CODE.BadRequest);
  }

  try {
    const timelineEvents = await giteaApiRequest(`/repos/${owner}/${repo}/issues/${index}/timeline`, "GET");
    const simplifiedTimeline = timelineEvents.map((event: any) => {
      let content = "";
      switch (event.event) { // Gitea API uses 'event', not 'type'
        case "closed":
        case "close":
          content = `关闭了此 Issue`;
          break;
        case "reopened":
          content = `重新打开了此 Issue`;
          break;
        case "comment":
          content = event.body;
          break;
        case "renamed":
          content = `将标题从 "${event.old_title}" 修改为 "${event.new_title}"`;
          break;
        case "commit_referenced":
          const sha = event.commit_url ? event.commit_url.split("/").pop().substring(0, 7) : (event.commit_id || "").substring(0, 7);
          content = `在提交 [${sha}] 中引用了此 Issue`;
          break;
        case "cross_referenced":
          content = `从 Issue #${event.issue.id} 引用了此 Issue`;
          break;
        case "label":
          content = `添加了标签: ${(event.label || {}).name || "未知"}`;
          break;
        case "assignees":
          content = `将任务指派给: ${(event.assignee || {}).login || "未知"}`;
          break;
        default:
          content = `未处理的事件类型: ${event.event}`;
      }
      return {
        type: event.event,
        user: (event.user?.full_name || event.user?.username) || "system",
        content: content,
        created_at: event.created_at,
      };
    });
    return Response.json(simplifiedTimeline);
  } catch (error) {
    console.error(`获取 Issue #${index} 的时间线失败:`, error);
    if (error.cause === STATUS_CODE.NotFound) {
      return jsonErrorResponse(`在 ${owner}/${repo} 中未找到 Issue #${index}`, STATUS_CODE.NotFound);
    }
    return jsonErrorResponse("无法从 Gitea 获取时间线", STATUS_CODE.InternalServerError);
  }
}

// --- 4. HTTP SERVER & ROUTING ---
/**
 * Main function to initialize and start the HTTP server.
 */
async function startServer() {
  await initialize();

  console.log("Gitea API 服务正在启动，监听 http://localhost:8000");
  Deno.serve(async (req: Request) => {
    const routes = [
      {pattern: new URLPattern({pathname: "/repos"}), method: "GET", handler: handleGetRepos},
      {pattern: new URLPattern({pathname: "/repos/:owner/:repo/issues"}), method: "GET", handler: handleListIssues},
      {pattern: new URLPattern({pathname: "/repos/:owner/:repo/issues"}), method: "POST", handler: handleCreateIssue},
      {
        pattern: new URLPattern({pathname: "/repos/:owner/:repo/issues/:index"}),
        method: "GET",
        handler: handleGetIssueDetails
      },
      {
        pattern: new URLPattern({pathname: "/repos/:owner/:repo/issues/:index/timeline"}),
        method: "GET",
        handler: handleGetIssueTimeline
      },
    ];

    const url = new URL(req.url);
    for (const route of routes) {
      const match = route.pattern.exec(url);
      if (match && req.method === route.method) {
        // @ts-ignore: TS can't fully infer the dynamic handler signature here but it's safe.
        return await route.handler(req, match);
      }
    }

    return jsonErrorResponse("Not Found", STATUS_CODE.NotFound);
  });
}

// Start the server
startServer();

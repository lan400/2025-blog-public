'use client'

import { useAuthStore } from '@/hooks/use-auth'
import { KJUR, KEYUTIL } from 'jsrsasign'
import { toast } from 'sonner'

export const GH_API = 'https://api.github.com'

function handle401Error(): void {
	if (typeof sessionStorage === 'undefined') return
	try {
		useAuthStore.getState().clearAuth()
	} catch (error) {
		console.error('Failed to clear auth cache:', error)
	}
}

function handle422Error(): void {
	toast.error('操作太快了，请操作慢一点')
}

async function throwGitHubApiError(action: string, res: Response): Promise<never> {
	const responseText = await res.text()

	if (res.status === 401) {
		handle401Error()
	}
	if (res.status === 422) {
		handle422Error()
	}

	const responseSummary = responseText ? ` - ${responseText}` : ''
	throw new Error(`${action} failed: ${res.status} ${res.statusText}${responseSummary}`)
}

export function toBase64Utf8(input: string): string {
	return btoa(unescape(encodeURIComponent(input)))
}

export function signAppJwt(appId: string, privateKeyPem: string): string {
	const now = Math.floor(Date.now() / 1000)
	const header = { alg: 'RS256', typ: 'JWT' }
	const payload = { iat: now - 60, exp: now + 8 * 60, iss: appId }
	const prv = KEYUTIL.getKey(privateKeyPem) as unknown as string
	return KJUR.jws.JWS.sign('RS256', JSON.stringify(header), JSON.stringify(payload), prv)
}

/**
 * 获取 GitHub App 在指定仓库的安装 ID
 * @param jwt - GitHub App 的 JWT
 * @param owner - 仓库所有者
 * @param repo - 仓库名称
 * @returns 安装 ID
 * @throws 详细的错误信息
 */
export async function getInstallationId(jwt: string, owner: string, repo: string): Promise<number> {
	// 验证输入参数
	if (!jwt || typeof jwt !== 'string') {
		throw new Error('JWT token is required and must be a string')
	}
	if (!owner || typeof owner !== 'string') {
		throw new Error('Owner is required and must be a string')
	}
	if (!repo || typeof repo !== 'string') {
		throw new Error('Repo is required and must be a string')
	}

	const GH_API = process.env.GITHUB_API_URL || 'https://api.github.com'
	const url = `${GH_API}/repos/${owner}/${repo}/installation`
	
	console.log(`[GitHub API] 获取安装ID: ${owner}/${repo}`)
	console.log(`[GitHub API] 请求URL: ${url}`)
	console.log(`[GitHub API] JWT 前10位: ${jwt.substring(0, 10)}...`)

	try {
		const startTime = Date.now()
		const res = await fetch(url, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${jwt}`,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
				'User-Agent': 'Your-App-Name/1.0.0'
			},
			// 可选：设置超时
			signal: AbortSignal.timeout(10000) // 10秒超时
		})

		const responseTime = Date.now() - startTime
		console.log(`[GitHub API] 响应时间: ${responseTime}ms, 状态码: ${res.status}`)

		// 解析响应体，但先不转为 JSON，保留原始文本
		const responseText = await res.text()
		
		// 处理不同的 HTTP 状态码
		switch (res.status) {
			case 200:
				// 成功
				try {
					const data = JSON.parse(responseText)
					console.log(`[GitHub API] 安装ID: ${data.id}, 应用: ${data.app_slug}`)
					return data.id
				} catch (jsonError) {
					console.error('[GitHub API] JSON 解析失败:', jsonError)
					console.error('[GitHub API] 原始响应:', responseText)
					throw new Error(`GitHub API 返回了无效的 JSON: ${jsonError.message}`)
				}
				
			case 401:
				console.error('[GitHub API] 401 Unauthorized - 认证失败')
				console.error('[GitHub API] 响应内容:', responseText)
				throw new Error(`GitHub App 认证失败: JWT 可能已过期或无效。请检查你的私钥和 App ID。详细: ${responseText}`)
				
			case 403:
				console.error('[GitHub API] 403 Forbidden - 权限不足')
				console.error('[GitHub API] 响应内容:', responseText)
				const rateLimit = res.headers.get('x-ratelimit-remaining')
				if (rateLimit === '0') {
					throw new Error('GitHub API 调用次数已达上限')
				}
				throw new Error(`没有权限访问仓库 ${owner}/${repo}。请确认 GitHub App 已安装。`)
				
			case 404:
				console.error('[GitHub API] 404 Not Found - 仓库不存在')
				throw new Error(`仓库 ${owner}/${repo} 不存在，或者 GitHub App 未安装到该仓库。`)
				
			case 422:
				console.error('[GitHub API] 422 Unprocessable Entity - 参数错误')
				console.error('[GitHub API] 响应内容:', responseText)
				throw new Error(`请求参数无效: ${responseText}`)
				
			default:
				// 其他错误
				console.error(`[GitHub API] 未知错误: ${res.status}`)
				console.error('[GitHub API] 响应头:', Object.fromEntries(res.headers.entries()))
				console.error('[GitHub API] 响应体:', responseText)
				
				let errorMessage = `GitHub API 错误: ${res.status} ${res.statusText}`
				try {
					const errorData = JSON.parse(responseText)
					if (errorData.message) {
						errorMessage += ` - ${errorData.message}`
					}
					if (errorData.documentation_url) {
						errorMessage += `\n文档: ${errorData.documentation_url}`
					}
				} catch {
					// 如果响应不是 JSON，使用原始文本
					errorMessage += `\n响应: ${responseText.substring(0, 200)}`
				}
				
				throw new Error(errorMessage)
		}
		
	} catch (error: any) {
		// 处理网络错误、超时等
		console.error('[GitHub API] 请求失败:', error)
		
		if (error.name === 'AbortError' || error.name === 'TimeoutError') {
			throw new Error(`GitHub API 请求超时 (10秒)，请检查网络连接`)
		}
		
		if (error.name === 'TypeError' && error.message.includes('fetch')) {
			throw new Error(`网络请求失败: ${error.message}，请检查网络连接`)
		}
		
		// 如果是我们已经处理过的错误，直接抛出
		if (error.message.includes('GitHub App')) {
			throw error
		}
		
		// 其他未处理的错误
		throw new Error(`获取安装ID失败: ${error.message || '未知错误'}`)
	}
}

export async function createInstallationToken(jwt: string, installationId: number): Promise<{ token: string; expiresAt: string }> {
	const res = await fetch(`${GH_API}/app/installations/${installationId}/access_tokens`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${jwt}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28'
		}
	})
	if (!res.ok) await throwGitHubApiError('create token', res)
	const data = await res.json()
	return {
		token: data.token as string,
		expiresAt: data.expires_at as string
	}
}

export async function getFileSha(token: string, owner: string, repo: string, path: string, branch: string): Promise<string | undefined> {
	const res = await fetch(`${GH_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28'
		}
	})
	if (res.status === 404) return undefined
	if (!res.ok) await throwGitHubApiError('get file sha', res)
	const data = await res.json()
	return (data && data.sha) || undefined
}

export async function putFile(token: string, owner: string, repo: string, path: string, contentBase64: string, message: string, branch: string) {
	const sha = await getFileSha(token, owner, repo, path, branch)
	const res = await fetch(`${GH_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
		method: 'PUT',
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ message, content: contentBase64, branch, ...(sha ? { sha } : {}) })
	})
	if (!res.ok) await throwGitHubApiError('put file', res)
	return res.json()
}

// Batch commit APIs

export async function getRef(token: string, owner: string, repo: string, ref: string): Promise<{ sha: string }> {
	const res = await fetch(`${GH_API}/repos/${owner}/${repo}/git/ref/${encodeURIComponent(ref)}`, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28'
		}
	})
	if (!res.ok) await throwGitHubApiError('get ref', res)
	const data = await res.json()
	return { sha: data.object.sha }
}

export type TreeItem = {
	path: string
	mode: '100644' | '100755' | '040000' | '160000' | '120000'
	type: 'blob' | 'tree' | 'commit'
	content?: string
	sha?: string | null
}

export async function createTree(token: string, owner: string, repo: string, tree: TreeItem[], baseTree?: string): Promise<{ sha: string }> {
	const res = await fetch(`${GH_API}/repos/${owner}/${repo}/git/trees`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ tree, base_tree: baseTree })
	})
	if (!res.ok) await throwGitHubApiError('create tree', res)
	const data = await res.json()
	return { sha: data.sha }
}

export async function createCommit(token: string, owner: string, repo: string, message: string, tree: string, parents: string[]): Promise<{ sha: string }> {
	const res = await fetch(`${GH_API}/repos/${owner}/${repo}/git/commits`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ message, tree, parents })
	})
	if (!res.ok) await throwGitHubApiError('create commit', res)
	const data = await res.json()
	return { sha: data.sha }
}

export async function updateRef(token: string, owner: string, repo: string, ref: string, sha: string, force = false): Promise<void> {
	const res = await fetch(`${GH_API}/repos/${owner}/${repo}/git/refs/${encodeURIComponent(ref)}`, {
		method: 'PATCH',
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ sha, force })
	})
	if (!res.ok) await throwGitHubApiError('update ref', res)
}

export async function readTextFileFromRepo(token: string, owner: string, repo: string, path: string, ref: string): Promise<string | null> {
	const res = await fetch(`${GH_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28'
		}
	})
	if (res.status === 404) return null
	if (!res.ok) await throwGitHubApiError('read file', res)
	const data: any = await res.json()
	if (Array.isArray(data) || !data.content) return null
	try {
		return decodeURIComponent(escape(atob(data.content)))
	} catch {
		return atob(data.content)
	}
}

export async function listRepoFilesRecursive(token: string, owner: string, repo: string, path: string, ref: string): Promise<string[]> {
	async function fetchPath(targetPath: string): Promise<string[]> {
		const res = await fetch(`${GH_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(targetPath)}?ref=${encodeURIComponent(ref)}`, {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28'
			}
		})
		if (res.status === 404) return []
		if (!res.ok) await throwGitHubApiError('read directory', res)
		const data: any = await res.json()
		if (Array.isArray(data)) {
			const files: string[] = []
			for (const item of data) {
				if (item.type === 'file') {
					files.push(item.path)
				} else if (item.type === 'dir') {
					const nested = await fetchPath(item.path)
					files.push(...nested)
				}
			}
			return files
		}
		if (data?.type === 'file') return [data.path]
		if (data?.type === 'dir') return fetchPath(data.path)
		return []
	}

	return fetchPath(path)
}

export async function createBlob(
	token: string,
	owner: string,
	repo: string,
	content: string,
	encoding: 'utf-8' | 'base64' = 'base64'
): Promise<{ sha: string }> {
	const res = await fetch(`${GH_API}/repos/${owner}/${repo}/git/blobs`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ content, encoding })
	})
	if (!res.ok) await throwGitHubApiError('create blob', res)
	const data = await res.json()
	return { sha: data.sha }
}

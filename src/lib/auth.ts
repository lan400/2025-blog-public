import { createInstallationToken, getInstallationId, signAppJwt } from './github-client'
import { GITHUB_CONFIG } from '@/consts'
import { useAuthStore } from '@/hooks/use-auth'
import { toast } from 'sonner'
import { decrypt,encrypt } from './aes256-util'

const GITHUB_TOKEN_CACHE_KEY = 'github_token'
const GITHUB_PEM_CACHE_KEY = 'p_info'
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000

type CachedTokenPayload = {
	token: string
	expiresAt: string
}

function getTokenFromCache(): string | null {
	if (typeof sessionStorage === 'undefined') return null
	try {
		const raw = sessionStorage.getItem(GITHUB_TOKEN_CACHE_KEY)
		if (!raw) return null

		const parsed = JSON.parse(raw) as Partial<CachedTokenPayload>
		if (!parsed.token || !parsed.expiresAt) {
			clearTokenCache()
			return null
		}

		const expiresAt = Date.parse(parsed.expiresAt)
		if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + TOKEN_EXPIRY_BUFFER_MS) {
			clearTokenCache()
			return null
		}

		return parsed.token
	} catch {
		clearTokenCache()
		return null
	}
}

function saveTokenToCache(token: string, expiresAt: string): void {
	if (typeof sessionStorage === 'undefined') return
	try {
		const payload: CachedTokenPayload = { token, expiresAt }
		sessionStorage.setItem(GITHUB_TOKEN_CACHE_KEY, JSON.stringify(payload))
	} catch (error) {
		console.error('Failed to save token to cache:', error)
	}
}

function clearTokenCache(): void {
	if (typeof sessionStorage === 'undefined') return
	try {
		sessionStorage.removeItem(GITHUB_TOKEN_CACHE_KEY)
	} catch (error) {
		console.error('Failed to clear token cache:', error)
	}
}

export async function getPemFromCache(): Promise<string | null> {
	if (typeof sessionStorage === 'undefined') return null
	try {
		// 解密缓存中的 pem
		const encryptedPem = sessionStorage.getItem(GITHUB_PEM_CACHE_KEY)
		if (!encryptedPem) return null
		return await decrypt(encryptedPem, GITHUB_CONFIG.ENCRYPT_KEY)
	} catch {
		return null
	}
}

export async function savePemToCache(pem: string): Promise<void> {
	if (typeof sessionStorage === 'undefined') return
	try {
		// 加密 pem 后存储
		const encryptedPem = await encrypt(pem, GITHUB_CONFIG.ENCRYPT_KEY)
		sessionStorage.setItem(GITHUB_PEM_CACHE_KEY, encryptedPem)
	} catch (error) {
		console.error('Failed to save pem to cache:', error)
	}
}

function clearPemCache(): void {
	if (typeof sessionStorage === 'undefined') return
	try {
		sessionStorage.removeItem(GITHUB_PEM_CACHE_KEY)
	} catch (error) {
		console.error('Failed to clear pem cache:', error)
	}
}

export function clearAllAuthCache(): void {
	clearTokenCache()
	clearPemCache()
}

export async function hasAuth(): Promise<boolean> {
	return !!getTokenFromCache() || !!(await getPemFromCache())
}

/**
 * 统一的认证 Token 获取
 * 自动处理缓存、签发等逻辑
 * @returns GitHub Installation Token
 */
export async function getAuthToken(): Promise<string> {
	// 1. 先尝试从缓存获取 token
	const cachedToken = getTokenFromCache()
	if (cachedToken) {
		toast.info('使用缓存的令牌...')
		return cachedToken
	}

	// 2. 获取私钥（从缓存）
	const privateKey = useAuthStore.getState().privateKey
	if (!privateKey) {
		throw new Error('需要先设置私钥。请使用 useAuth().setPrivateKey()')
	}

	console.log('[GitHub Auth] Effective config', {
		owner: GITHUB_CONFIG.OWNER,
		repo: GITHUB_CONFIG.REPO,
		branch: GITHUB_CONFIG.BRANCH,
		appId: GITHUB_CONFIG.APP_ID
	})

	toast.info('正在签发 JWT...')
	const jwt = signAppJwt(GITHUB_CONFIG.APP_ID, privateKey)

	toast.info('正在获取安装信息...')
	const installationId = await getInstallationId(jwt, GITHUB_CONFIG.OWNER, GITHUB_CONFIG.REPO)

	toast.info('正在创建安装令牌...')
	const { token, expiresAt } = await createInstallationToken(jwt, installationId)

	saveTokenToCache(token, expiresAt)

	return token
}

<script setup lang="ts">
import { Sparkles, Loader2, CheckCircle, XCircle, Eye, EyeOff } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

const props = defineProps<{
  llm: { provider: 'none' | 'gemini' | 'ollama'; geminiModel: string; ollamaBaseUrl: string; ollamaModel: string }
  gemini: { isConfigured: boolean }
}>()

const emit = defineEmits<{ refresh: [] }>()

const settingsApi = useSettingsApi()

const form = ref({
  provider: props.llm.provider,
  geminiModel: props.llm.geminiModel || 'gemini-2.5-flash',
  ollamaBaseUrl: props.llm.ollamaBaseUrl || 'http://ollama:11434',
  ollamaModel: props.llm.ollamaModel || 'qwen2.5:1.5b',
  geminiApiKey: '',
})

const showGeminiKey = ref(false)
const saving = ref(false)
const testing = ref(false)
const testResult = ref<{ ok: boolean; message: string } | null>(null)

watch(() => props.llm, (v) => {
  form.value.provider = v.provider
  form.value.geminiModel = v.geminiModel || form.value.geminiModel
  form.value.ollamaBaseUrl = v.ollamaBaseUrl || form.value.ollamaBaseUrl
  form.value.ollamaModel = v.ollamaModel || form.value.ollamaModel
})

async function handleSave() {
  saving.value = true
  testResult.value = null
  try {
    // Save Gemini key if user typed one
    if (form.value.geminiApiKey) {
      await settingsApi.saveGeminiConfig(form.value.geminiApiKey)
      form.value.geminiApiKey = ''
    }
    // Save LLM provider + Ollama settings
    await settingsApi.saveLlmConfig({
      provider: form.value.provider,
      geminiModel: form.value.provider === 'gemini' ? form.value.geminiModel : undefined,
      ollamaBaseUrl: form.value.provider === 'ollama' ? form.value.ollamaBaseUrl : undefined,
      ollamaModel: form.value.provider === 'ollama' ? form.value.ollamaModel : undefined,
    })
    toast.success('LLM 設定已儲存')
    emit('refresh')
  } catch (e) {
    toast.error('儲存失敗', { description: String(e) })
  } finally {
    saving.value = false
  }
}

async function handleTest() {
  testing.value = true
  testResult.value = null
  try {
    const r = await settingsApi.testLlm()
    testResult.value = r
    if (r.ok) toast.success(r.message)
    else toast.error(r.message)
  } catch (e: any) {
    const msg = e?.data?.message ?? e?.message ?? String(e)
    testResult.value = { ok: false, message: msg }
    toast.error(msg)
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Sparkles class="h-5 w-5" />
        <h3 class="text-sm font-semibold">AI 解析器</h3>
        <span class="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <span
            class="inline-block h-2 w-2 rounded-full shrink-0"
            :class="llm.provider === 'none' ? 'bg-muted-foreground' : 'bg-green-500'"
          />
          {{ llm.provider === 'none' ? '未啟用' : llm.provider === 'gemini' ? 'Gemini (雲端)' : 'Ollama (本地)' }}
        </span>
      </div>
    </div>
    <p class="text-xs text-muted-foreground">
      帳單 PDF 自動解析（LLM 優先），或於帳單詳情頁按「AI 重新解析」。關閉則完全不載入模型。
    </p>

    <!-- Provider selector -->
    <div class="space-y-2">
      <Label>使用哪個 Provider</Label>
      <Select v-model="form.provider">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">關閉（不使用 AI）</SelectItem>
          <SelectItem value="gemini">Gemini (Google 雲端，免費額度)</SelectItem>
          <SelectItem value="ollama">Ollama (本地自架，隱私保護)</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- Gemini config -->
    <div v-if="form.provider === 'gemini'" class="space-y-3 rounded-md border p-3 bg-muted/30">
      <div class="space-y-1">
        <div class="flex items-center justify-between">
          <Label class="text-xs">Gemini API Key</Label>
          <span v-if="gemini.isConfigured" class="text-xs text-green-600 dark:text-green-400">✓ 已設定</span>
        </div>
        <div class="relative">
          <Input
            v-model="form.geminiApiKey"
            :type="showGeminiKey ? 'text' : 'password'"
            :placeholder="gemini.isConfigured ? '輸入新的 API Key 以覆蓋' : 'AIzaSy...'"
            class="pr-10"
          />
          <button
            type="button"
            class="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
            @click="showGeminiKey = !showGeminiKey"
          >
            <Eye v-if="!showGeminiKey" class="h-4 w-4" />
            <EyeOff v-else class="h-4 w-4" />
          </button>
        </div>
        <p class="text-xs text-muted-foreground">
          到 <a href="https://aistudio.google.com/apikey" target="_blank" class="underline">Google AI Studio</a> 取得 API Key
        </p>
      </div>
      <div class="space-y-1">
        <Label class="text-xs">Model</Label>
        <Input v-model="form.geminiModel" placeholder="gemini-2.5-flash" class="font-mono text-sm" />
        <p class="text-xs text-muted-foreground">
          常用免費 model：<code class="px-1 rounded bg-background">gemini-2.5-flash</code>（10 RPM / 250 RPD）、
          <code class="px-1 rounded bg-background">gemini-2.5-flash-lite</code>（15 RPM / 1,000 RPD，最寬鬆）、
          <code class="px-1 rounded bg-background">gemini-2.5-pro</code>（5 RPM / 100 RPD，最強）。
          <a href="https://ai.google.dev/gemini-api/docs/models" target="_blank" class="underline">完整清單</a>
        </p>
      </div>
    </div>

    <!-- Ollama config -->
    <div v-if="form.provider === 'ollama'" class="space-y-2 rounded-md border p-3 bg-muted/30">
      <div class="space-y-1">
        <Label class="text-xs">Ollama Base URL</Label>
        <Input v-model="form.ollamaBaseUrl" placeholder="http://ollama:11434" class="font-mono text-sm" />
        <p class="text-xs text-muted-foreground">Docker 內通常是 http://ollama:11434；本機開發用 http://localhost:11434</p>
      </div>
      <div class="space-y-1">
        <Label class="text-xs">Model</Label>
        <Input v-model="form.ollamaModel" placeholder="qwen2.5:1.5b" class="font-mono text-sm" />
        <p class="text-xs text-muted-foreground">
          預設 qwen2.5:1.5b（~1GB，繁中佳）；更省資源選 qwen2.5:0.5b。<br>
          docker compose 會自動 pull。要換模型可改 .env 的 <code class="px-1 rounded bg-background">OLLAMA_MODEL</code> 後 <code class="px-1 rounded bg-background">docker compose up -d</code>
        </p>
      </div>
    </div>

    <!-- Actions -->
    <div class="flex gap-2">
      <Button size="sm" :disabled="saving" @click="handleSave">
        {{ saving ? '儲存中...' : '儲存' }}
      </Button>
      <Button
        v-if="form.provider !== 'none'"
        size="sm"
        variant="outline"
        :disabled="testing"
        @click="handleTest"
      >
        <Loader2 v-if="testing" class="h-3.5 w-3.5 animate-spin" />
        測試連線
      </Button>
    </div>

    <div v-if="testResult" class="flex items-center gap-2 text-xs">
      <CheckCircle v-if="testResult.ok" class="h-3.5 w-3.5 text-green-500" />
      <XCircle v-else class="h-3.5 w-3.5 text-red-500" />
      <span :class="testResult.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'">
        {{ testResult.message }}
      </span>
    </div>
  </div>
</template>

<template>
  <div class="space-y-6 max-w-3xl">
    <div>
      <h2 class="text-2xl font-bold tracking-tight">解析器測試</h2>
      <p class="text-muted-foreground">上傳 PDF 或貼上文字，測試帳單解析結果。不需要設定 Gmail 或通知。</p>
    </div>

    <!-- Tab Selector -->
    <div class="flex gap-2">
      <Button
        :variant="mode === 'pdf' ? 'default' : 'outline'"
        size="sm"
        @click="mode = 'pdf'"
      >
        <FileUp class="h-4 w-4" />
        上傳 PDF
      </Button>
      <Button
        :variant="mode === 'text' ? 'default' : 'outline'"
        size="sm"
        @click="mode = 'text'"
      >
        <Type class="h-4 w-4" />
        貼上文字
      </Button>
    </div>

    <!-- Options -->
    <Card>
      <CardContent class="pt-6 space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="space-y-2">
            <Label for="bankCode">銀行解析器</Label>
            <Select v-model="bankCode">
              <SelectTrigger>
                <SelectValue placeholder="自動偵測" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem :value="''">自動偵測 (generic)</SelectItem>
                <SelectItem v-for="p in parsers" :key="p.code" :value="p.code">
                  {{ p.code }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div v-if="mode === 'pdf'" class="space-y-2">
            <Label for="password">PDF 密碼</Label>
            <Input id="password" v-model="password" type="password" placeholder="留空表示無密碼" />
          </div>
        </div>

        <div class="flex items-center gap-2">
          <Switch id="useLlm" v-model:checked="useLlm" />
          <Label for="useLlm" class="text-sm">Regex 失敗時使用 LLM fallback</Label>
        </div>

        <!-- PDF Upload -->
        <div v-if="mode === 'pdf'" class="space-y-2">
          <Label>PDF 檔案</Label>
          <div
            class="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer transition-colors hover:border-primary/50"
            :class="{ 'border-primary': dragover }"
            @dragover.prevent="dragover = true"
            @dragleave="dragover = false"
            @drop.prevent="handleDrop"
            @click="fileInputRef?.click()"
          >
            <Upload class="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p v-if="!selectedFile" class="text-sm text-muted-foreground">
              拖放 PDF 檔案至此，或點擊選擇
            </p>
            <p v-else class="text-sm font-medium">
              {{ selectedFile.name }}
              <span class="text-muted-foreground ml-1">({{ (selectedFile.size / 1024).toFixed(1) }} KB)</span>
            </p>
          </div>
          <input ref="fileInputRef" type="file" accept=".pdf" class="hidden" @change="handleFileSelect" />
        </div>

        <!-- Text Input -->
        <div v-if="mode === 'text'" class="space-y-2">
          <Label for="textInput">PDF 文字內容</Label>
          <Textarea
            id="textInput"
            v-model="textInput"
            placeholder="貼上從 PDF 提取的文字..."
            class="min-h-40 font-mono text-sm"
          />
        </div>

        <Button :disabled="parsing || !canParse" class="w-full" @click="handleParse">
          <Loader2 v-if="parsing" class="h-4 w-4 animate-spin" />
          <FlaskConical v-else class="h-4 w-4" />
          {{ parsing ? '解析中...' : '測試解析' }}
        </Button>
      </CardContent>
    </Card>

    <!-- Result -->
    <Card v-if="result">
      <CardHeader>
        <CardTitle class="text-base flex items-center gap-2">
          <component :is="result.regexResult || result.llmResult ? CircleCheck : CircleX" class="h-4 w-4" :class="result.regexResult || result.llmResult ? 'text-green-500' : 'text-red-500'" />
          解析結果
        </CardTitle>
        <CardDescription>
          使用解析器：{{ result.parserUsed ?? result.bankCode ?? 'generic' }}
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <!-- Parsed Bill Data -->
        <div v-if="result.regexResult" class="space-y-3">
          <Badge class="bg-green-500/15 text-green-500 border-green-500/25">Regex 解析成功</Badge>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1">
              <Label class="text-muted-foreground text-xs">應繳金額</Label>
              <p class="text-lg font-bold">NT$ {{ result.regexResult.amount.toLocaleString() }}</p>
            </div>
            <div class="space-y-1">
              <Label class="text-muted-foreground text-xs">繳費截止日</Label>
              <p class="text-lg font-bold">{{ result.regexResult.dueDate }}</p>
            </div>
            <div v-if="result.regexResult.minimumPayment" class="space-y-1">
              <Label class="text-muted-foreground text-xs">最低應繳</Label>
              <p class="font-medium">NT$ {{ result.regexResult.minimumPayment.toLocaleString() }}</p>
            </div>
            <div class="space-y-1">
              <Label class="text-muted-foreground text-xs">帳單月份</Label>
              <p class="font-medium">{{ result.regexResult.billingPeriod }}</p>
            </div>
          </div>
        </div>

        <div v-else-if="result.llmResult && !result.llmResult.error" class="space-y-3">
          <Badge class="bg-blue-500/15 text-blue-500 border-blue-500/25">LLM 解析成功</Badge>
          <pre class="text-sm bg-muted rounded-md p-3 overflow-x-auto">{{ JSON.stringify(result.llmResult, null, 2) }}</pre>
        </div>

        <div v-else class="space-y-2">
          <Badge class="bg-red-500/15 text-red-500 border-red-500/25">解析失敗</Badge>
          <p v-if="result.llmResult?.error" class="text-sm text-muted-foreground">
            LLM fallback 錯誤：{{ result.llmResult.error }}
          </p>
          <p v-else class="text-sm text-muted-foreground">
            Regex 無法匹配，{{ useLlm ? '且 LLM fallback 也失敗' : '可嘗試開啟 LLM fallback' }}
          </p>
        </div>

        <Separator />

        <!-- Raw PDF Text -->
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <Label class="text-sm font-medium">PDF 原始文字</Label>
            <span class="text-xs text-muted-foreground">{{ result.pdfTextLength ?? result.pdfText?.length ?? 0 }} 字元</span>
          </div>
          <pre class="whitespace-pre-wrap text-xs text-muted-foreground bg-muted rounded-md p-3 max-h-80 overflow-y-auto font-mono">{{ result.pdfText }}</pre>
        </div>
      </CardContent>
    </Card>

    <!-- Error -->
    <Card v-if="parseError">
      <CardContent class="py-6">
        <div class="flex items-center gap-2 text-destructive">
          <CircleX class="h-4 w-4" />
          <span class="text-sm font-medium">{{ parseError }}</span>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import {
  FileUp,
  Type,
  Upload,
  Loader2,
  FlaskConical,
  CircleCheck,
  CircleX,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'

const mode = ref<'pdf' | 'text'>('pdf')
const bankCode = ref('')
const password = ref('')
const useLlm = ref(false)
const selectedFile = ref<File | null>(null)
const textInput = ref('')
const parsing = ref(false)
const dragover = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)

interface ParseResult {
  pdfText?: string
  pdfTextLength?: number
  bankCode?: string | null
  parserUsed?: string
  regexResult?: {
    amount: number
    minimumPayment?: number
    dueDate: string
    billingPeriod: string
  } | null
  llmResult?: Record<string, unknown> | null
}

const result = ref<ParseResult | null>(null)
const parseError = ref<string | null>(null)

// Fetch available parsers
const parsers = ref<Array<{ code: string; bankCode: string }>>([])
onMounted(async () => {
  try {
    const data = await $fetch<{ parsers: Array<{ code: string; bankCode: string }> }>('/api/dev/parsers')
    parsers.value = data.parsers
  } catch {}
})

const canParse = computed(() => {
  if (mode.value === 'pdf') return !!selectedFile.value
  return !!textInput.value.trim()
})

function handleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files?.[0]) selectedFile.value = input.files[0]
}

function handleDrop(e: DragEvent) {
  dragover.value = false
  const file = e.dataTransfer?.files[0]
  if (file?.type === 'application/pdf') selectedFile.value = file
  else toast.error('請上傳 PDF 檔案')
}

async function handleParse() {
  parsing.value = true
  result.value = null
  parseError.value = null

  try {
    if (mode.value === 'pdf') {
      const formData = new FormData()
      formData.append('file', selectedFile.value!)
      if (bankCode.value) formData.append('bank', bankCode.value)
      if (password.value) formData.append('password', password.value)
      if (useLlm.value) formData.append('llm', 'true')

      result.value = await $fetch<ParseResult>('/api/dev/parse-pdf', {
        method: 'POST',
        body: formData,
      })
    } else {
      result.value = await $fetch<ParseResult>('/api/dev/parse-text', {
        method: 'POST',
        body: {
          text: textInput.value,
          bank: bankCode.value || undefined,
          llm: useLlm.value,
        },
      })
    }
  } catch (e: any) {
    const data = e?.data
    parseError.value = data?.error ?? e?.message ?? '解析失敗'
  } finally {
    parsing.value = false
  }
}

useHead({ title: '解析器測試 - Bill Alarm' })
</script>

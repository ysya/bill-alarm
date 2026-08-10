<script setup lang="ts">
import { CheckCircle2, ChevronRight, Circle } from 'lucide-vue-next'
import { Card } from '@/components/ui/card'
import type { OnboardingStatusDTO } from '@bill-alarm/shared/types'

const { isAdmin } = useAuth()

const status = ref<OnboardingStatusDTO | null>(null)

onMounted(async () => {
  try {
    status.value = await useSettingsApi().getOnboardingStatus()
  }
  catch {
    // leave null — never block the overview on this hint
  }
})

interface Step {
  key: string
  label: string
  done: boolean
  hint: string | null
  to: string
}

const steps = computed<Step[]>(() => {
  const s = status.value
  if (!s) return []
  const telegramDone = s.botConfigured && s.telegramBound
  let telegramHint: string | null = null
  let telegramTo = '/settings#notifications'
  if (!telegramDone) {
    if (!s.botConfigured) {
      telegramHint = isAdmin.value ? '先設定 Bot Token' : '等待管理員設定 Bot'
      telegramTo = isAdmin.value ? '/settings#system' : '/settings#notifications'
    }
    else {
      telegramHint = '去綁定'
    }
  }
  return [
    { key: 'email', label: '連接信箱', done: s.emailConfigured, hint: s.emailConfigured ? null : '完成 IMAP 授權', to: '/settings#data-source' },
    { key: 'bank', label: '啟用你的銀行', done: s.hasActiveBank, hint: s.hasActiveBank ? null : '選擇要追蹤的銀行', to: '/banks' },
    { key: 'telegram', label: '打開 Telegram 通知', done: telegramDone, hint: telegramHint, to: telegramTo },
  ]
})

const allDone = computed(() => steps.value.length > 0 && steps.value.every(s => s.done))
const visible = computed(() => status.value !== null && !allDone.value)
</script>

<template>
  <Card
    v-if="visible"
    class="border-primary/40 bg-primary/5 p-4"
  >
    <p class="text-sm font-medium">
      完成設定，開始自動追蹤帳單
    </p>
    <ul class="mt-3 space-y-2">
      <li
        v-for="step in steps"
        :key="step.key"
      >
        <div
          v-if="step.done"
          class="flex items-center gap-2 text-sm"
        >
          <CheckCircle2 class="h-4 w-4 shrink-0 text-green-500" />
          <span class="text-muted-foreground line-through">{{ step.label }}</span>
        </div>
        <NuxtLink
          v-else
          :to="step.to"
          class="group flex items-center gap-2 text-sm"
        >
          <Circle class="h-4 w-4 shrink-0 text-muted-foreground" />
          <span class="group-hover:underline">{{ step.label }}</span>
          <span
            v-if="step.hint"
            class="text-xs text-muted-foreground"
          >— {{ step.hint }}</span>
          <ChevronRight class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </NuxtLink>
      </li>
    </ul>
  </Card>
</template>

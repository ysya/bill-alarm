<script setup lang="ts">
import { CalendarCheck, Copy, ExternalLink, HelpCircle, RefreshCw } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

const props = defineProps<{
  calendar: { feedUrl: string; feedPath: string; token: string }
}>()

const emit = defineEmits<{ refresh: [] }>()

const settingsApi = useSettingsApi()
const rotating = ref(false)
const helpDialogOpen = ref(false)

const fullUrl = computed(() => {
  if (props.calendar.feedUrl.startsWith('http')) return props.calendar.feedUrl
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${props.calendar.feedPath}`
  }
  return props.calendar.feedPath
})

async function handleCopy() {
  try {
    await navigator.clipboard.writeText(fullUrl.value)
    toast.success('已複製訂閱網址')
  } catch (e) {
    toast.error('複製失敗', { description: String(e) })
  }
}

async function handleRotate() {
  if (!confirm('重新產生 token 後，舊網址會立刻失效。確定要繼續嗎？')) return
  rotating.value = true
  try {
    await settingsApi.rotateCalendarToken()
    toast.success('已產生新的訂閱網址，請更新訂閱端')
    emit('refresh')
  } catch (e) {
    toast.error('產生失敗', { description: String(e) })
  } finally {
    rotating.value = false
  }
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <CalendarCheck class="h-5 w-5" />
        <h3 class="text-sm font-semibold">行事曆訂閱（ICS Feed）</h3>
      </div>
      <Button type="button" size="sm" variant="ghost" @click="helpDialogOpen = true">
        <HelpCircle class="mr-1 h-4 w-4" />
        如何訂閱？
      </Button>
    </div>

    <p class="text-xs text-muted-foreground">
      把帳單到期日當作日曆事件單向訂閱，不需 OAuth、不需授權。複製下方網址貼到任何支援
      iCalendar 的應用程式（Google Calendar、Apple 行事曆、Outlook 等）。
    </p>

    <div class="space-y-2">
      <Label>訂閱網址</Label>
      <div class="flex gap-2">
        <Input :model-value="fullUrl" readonly class="font-mono text-xs" />
        <Button size="sm" variant="outline" @click="handleCopy">
          <Copy class="mr-2 h-4 w-4" />
          複製
        </Button>
      </div>
    </div>

    <div class="flex items-center gap-2 flex-wrap">
      <Button size="sm" variant="outline" as-child>
        <a href="https://calendar.google.com/calendar/u/0/r/settings/addbyurl" target="_blank">
          <ExternalLink class="mr-2 h-4 w-4" />
          到 Google Calendar 訂閱頁
        </a>
      </Button>
      <Button size="sm" variant="ghost" :disabled="rotating" @click="handleRotate">
        <RefreshCw class="mr-2 h-4 w-4" :class="{ 'animate-spin': rotating }" />
        重新產生 token
      </Button>
    </div>

    <Dialog v-model:open="helpDialogOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>如何訂閱 ICS Feed</DialogTitle>
          <DialogDescription>
            ICS Feed 是單向唯讀的標準行事曆格式，幾乎所有日曆 App 都支援。
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4 text-sm">
          <div>
            <p class="font-medium mb-2">Google Calendar（網頁）</p>
            <ol class="space-y-1 list-decimal pl-5 text-xs text-muted-foreground">
              <li>左側「其他日曆」旁邊的「+」→「以網址新增」</li>
              <li>貼上上方訂閱網址 → 按「新增日曆」</li>
              <li>
                或直接前往
                <a href="https://calendar.google.com/calendar/u/0/r/settings/addbyurl" target="_blank" class="underline inline-flex items-center gap-0.5">
                  訂閱頁<ExternalLink class="h-3 w-3" />
                </a>
              </li>
            </ol>
          </div>

          <div>
            <p class="font-medium mb-2">Apple 行事曆（Mac/iPhone）</p>
            <ol class="space-y-1 list-decimal pl-5 text-xs text-muted-foreground">
              <li>Mac：檔案 → 新增日曆訂閱 → 貼上網址</li>
              <li>iOS：設定 → 行事曆 → 帳號 → 加入帳號 → 其他 → 加入訂閱行事曆</li>
            </ol>
          </div>

          <div>
            <p class="font-medium mb-2">Microsoft Outlook</p>
            <ol class="space-y-1 list-decimal pl-5 text-xs text-muted-foreground">
              <li>檔案 → 帳戶設定 → 網際網路行事曆 → 新增 → 貼上網址</li>
            </ol>
          </div>

          <div class="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5 text-xs text-muted-foreground">
            <p class="font-medium text-foreground">注意事項</p>
            <p>
              <span class="font-medium">同步頻率：</span>
              Google Calendar 約每 8–24 小時拉取一次，新帳單不會即時出現。Apple 與 Outlook 可手動設定間隔。
            </p>
            <p>
              <span class="font-medium">安全性：</span>
              網址中的 token 等同於只能讀取帳單清單的 API key。若不慎外洩，按「重新產生 token」立即失效，再去訂閱端更新網址。
            </p>
            <p>
              <span class="font-medium">提醒：</span>
              事件內含到期日前 1 天與 1 小時兩個提醒（依日曆 App 規則顯示）。
            </p>
            <p>
              <span class="font-medium">已繳清：</span>
              標記為已繳的帳單會在下次同步時從訂閱中移除。
            </p>
          </div>
        </div>

        <DialogFooter>
          <DialogClose as-child>
            <Button variant="outline">了解</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

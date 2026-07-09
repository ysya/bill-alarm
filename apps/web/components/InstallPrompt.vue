<script setup lang="ts">
import { Share, Smartphone, SquarePlus, X } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

const props = defineProps<{ variant: 'banner' | 'row' }>()

const { showEntry, bannerVisible, canNativeInstall, iosGuideOpen, triggerInstall, dismissBanner } = useInstallPrompt()

const visible = computed(() => (props.variant === 'banner' ? bannerVisible.value : showEntry.value))
const buttonText = computed(() => (canNativeInstall.value ? '安裝' : '查看安裝步驟'))
</script>

<template>
  <template v-if="visible">
    <!-- Banner：總覽頂部，可關閉 -->
    <div
      v-if="variant === 'banner'"
      class="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5"
    >
      <Smartphone class="h-5 w-5 shrink-0 text-muted-foreground" />
      <p class="min-w-0 flex-1 text-sm">
        把 Bill Alarm 安裝到主畫面，開啟更快。
      </p>
      <Button
        size="sm"
        @click="triggerInstall"
      >
        {{ buttonText }}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        class="shrink-0 px-2"
        aria-label="關閉"
        @click="dismissBanner"
      >
        <X class="h-4 w-4" />
      </Button>
    </div>

    <!-- Row：設定頁固定入口 -->
    <Card
      v-else
      class="flex flex-wrap items-center justify-between gap-3 p-4"
    >
      <div class="flex min-w-0 items-center gap-3">
        <Smartphone class="h-5 w-5 shrink-0 text-muted-foreground" />
        <div class="min-w-0">
          <p class="text-sm font-medium">
            安裝 App
          </p>
          <p class="text-xs text-muted-foreground">
            加入主畫面，以全螢幕開啟。
          </p>
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        @click="triggerInstall"
      >
        {{ buttonText }}
      </Button>
    </Card>
  </template>

  <!-- iOS 安裝引導（兩個 variant 共用全域狀態；Dialog 放 visible 判斷之外，
       避免 banner 被關掉後 dialog 一併消失） -->
  <Dialog v-model:open="iosGuideOpen">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>加入主畫面</DialogTitle>
        <DialogDescription>iPhone 需透過 Safari 手動加入主畫面：</DialogDescription>
      </DialogHeader>
      <ol class="space-y-3 text-sm">
        <li class="flex items-center gap-3">
          <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs">1</span>
          <span class="flex items-center gap-1.5">點底部工具列的分享按鈕 <Share class="h-4 w-4" /></span>
        </li>
        <li class="flex items-center gap-3">
          <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs">2</span>
          <span class="flex items-center gap-1.5">往下捲，選「加入主畫面」 <SquarePlus class="h-4 w-4" /></span>
        </li>
        <li class="flex items-center gap-3">
          <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs">3</span>
          <span>點右上角「加入」完成</span>
        </li>
      </ol>
      <p class="text-xs text-muted-foreground">
        若使用 Chrome 或 App 內建瀏覽器開啟，請先改用 Safari。
      </p>
      <DialogFooter>
        <DialogClose as-child>
          <Button variant="outline">
            知道了
          </Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

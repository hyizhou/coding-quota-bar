<template>
  <div class="feedback-container">
    <h2>{{ $t('settings.feedbackGroup') }}</h2>
    <img :src="feishuImg" alt="QR" class="qr-img" />
    <p class="scan-tip">{{ $t('settings.feedbackScanTip') }}</p>
    <a class="join-link" @click.prevent="openLink">{{ $t('settings.feedbackClickLink') }}</a>
  </div>
</template>

<script setup lang="ts">
import feishuImg from '../assets/feishu.png'

const FEISHU_LINK = 'https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=9f3hcab1-6867-43e9-938e-3f49bb3ccdc3'

function openLink() {
  window.electronAPI.openExternal(FEISHU_LINK)
}
</script>

<style scoped>
.feedback-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background: #f5f5f5;
  color: #333;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

h2 {
  font-size: 16px;
  margin-bottom: 16px;
  font-weight: 600;
}

.qr-img {
  width: 200px;
  height: 200px;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
}

.scan-tip {
  margin-top: 12px;
  font-size: 12px;
  color: #666;
}

.join-link {
  margin-top: 16px;
  font-size: 13px;
  color: #3370ff;
  text-decoration: none;
  cursor: pointer;
}

.join-link:hover {
  text-decoration: underline;
}
</style>

<template>
  <UApp>
    <NuxtRouteAnnouncer />
    <NuxtLoadingIndicator :height="3" :throttle="100" :duration="1000" />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>

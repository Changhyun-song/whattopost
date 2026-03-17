import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  appName: 'whattopost', // 콘솔에 등록한 값과 반드시 동일
  brand: {
    displayName: '뭐 올리지?',
    primaryColor: '#3182F6',
    icon: '',
  },
  web: {
    host: '192.168.219.102',
    port: 5173,
    commands: {
      dev: 'vite --host',
      build: 'tsc -b && vite build',
    },
  },
  permissions: [],
});
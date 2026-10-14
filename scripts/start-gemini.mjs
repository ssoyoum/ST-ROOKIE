// Explicit demonstration mode, independent of old local/private provider settings.
process.env.LLM_PROVIDER = 'gemini';
process.env.PRIVATE_LLM_ONLY = '0';
process.env.WARM_ANSWERS ??= 'off';
console.log('Gemini 시연 모드: 학습·평가·관리자 요약에 같은 provider를 사용합니다.');
await import('../.build/backend/src/ironmaking-server.js');

/** 모든 LLM provider가 구현하는 공통 생성 요청. */
export interface GenerateRequest {
  system: string;
  prompt: string;
  temperature: number;
  maxOutputTokens: number;
  /** 있으면 JSON 응답 형식을 요청한다. provider가 지원하는 형식으로 변환한다. */
  responseSchema?: object;
}

/** 튜터·평가자·Agent가 provider 종류를 알 필요 없게 하는 최소 계약. */
export interface LlmClient {
  generate(req: GenerateRequest): Promise<string>;
}

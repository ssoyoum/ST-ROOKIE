/** 모든 LLM provider가 구현하는 공통 생성 요청. */
export interface GenerateRequest {
  system: string;
  prompt: string;
  temperature: number;
  maxOutputTokens: number;
  /** 있으면 JSON 응답 형식을 요청한다. provider가 지원하는 형식으로 변환한다. */
  responseSchema?: object;
  /**
   * 있으면 받은 글자를 차례로 받는다(스트리밍, 학습 모드 답을 화면에 바로 보여 줄 때). 지금까지 받은 전체 텍스트를 넘긴다.
   * 지원하지 않는 provider는 부르지 않고 끝에 한 번에 돌려준다. 돌려주는 값은 스트리밍과 상관없이 전체 텍스트다.
   */
  onText?: (soFar: string) => void;
}

/** 튜터·평가자·Agent가 provider 종류를 알 필요 없게 하는 최소 계약. */
export interface LlmClient {
  generate(req: GenerateRequest): Promise<string>;
}

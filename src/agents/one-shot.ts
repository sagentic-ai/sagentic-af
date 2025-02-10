// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: BUSL-1.1

import { AgentOptions, BaseAgent } from "../agent";
import { BuiltinModel, ModelMetadata } from "../models";
import { Session } from "../session";
import { Thread } from "../thread";

export class OneShotAgent<
  OptionsType extends AgentOptions,
  ResultType
> extends BaseAgent<OptionsType, void, ResultType> {
  model: BuiltinModel | ModelMetadata = BuiltinModel.GPT35Turbo;
  thread: Thread;

  constructor(session: Session, options: OptionsType) {
    super(session, options);
    this.thread = this.createThread();
  }

  async input(): Promise<string> {
    throw new Error("Method not implemented.");
  }

  async inputImages(): Promise<string[] | undefined> {
    return undefined;
  }

  async inputAudio(): Promise<string | undefined> {
    return undefined;
  }

  async inputVideo(): Promise<string | undefined> {
    return undefined;
  }

  async output(_answer: string): Promise<ResultType> {
    throw new Error("Method not implemented.");
  }

  async initialize(_options: OptionsType): Promise<void> {
    this.thread.appendUserMessage(await this.input());

    if (this.modelDetails?.supportsImages) {
      const images = await this.inputImages();
      if (images) {
        for (const image of images) {
          this.thread.appendUserImage(image);
        }
      }
    }

    if (this.modelDetails?.supportsAudio) {
      const audio = await this.inputAudio();
      if (audio) {
        this.thread.appendUserAudio(audio);
      }
    }

    if (this.modelDetails?.supportsVideo) {
      const video = await this.inputVideo();
      if (video) {
        this.thread.appendUserVideo(video);
      }
    }
  }

  async step(): Promise<void> {
    this.thread = await this.advance(this.thread);
    this.stop();
  }

  async finalize(): Promise<ResultType> {
    return this.output(this.thread.assistantResponse);
  }
}

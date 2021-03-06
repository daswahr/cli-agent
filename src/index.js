// @flow

import pty from 'pty.js';
import log from './logger';

export default class {
  state = 'pending';
  msg = '';
  timeStep = 500;
  lines = [];
  linesPointer = 0;
  chain = [];
  chainPointer = 0

  constructor(programm, options = {}) {
    this.programm = programm;
    this.timeout = options.timeout || 2000;
  }

  hasNewLine() {
    return this.lines.length > this.linesPointer;
  }

  nextLine() {
    if (!this.hasNewLine()) {
      return null;
    }
    const line = this.lines[this.linesPointer];
    this.linesPointer += 1;
    return line;
  }

  hasNewAction() {
    return this.chain.length > this.chainPointer;
  }

  nextAction() {
    if (!this.hasNewAction()) {
      return null;
    }
    const action = this.chain[this.chainPointer];
    this.chainPointer += 1;
    return action;
  }

  executeNextAction() {
    if (!this.hasNewAction()) {
      this.state = 'fulfilled';
      log('interaction have been finished (successufully)');
      this.stop();
    }
    const action = this.nextAction();
    log('executeNextAction', action.type, action.payload);
    return action.func();
  }

  wait(regexp, cb = () => {}) {
    log(`wait: ${regexp}`);
    this.chain.push({
      type: 'wait',
      payload: regexp,
      func: () => {
        const iter = (passedTime = 0) => setTimeout(() => {
          const matches = this.matchOutput(regexp);
          if (matches) {
            log(`output matched with '${regexp}'`);
            cb(matches);
            this.executeNextAction();
          } else {
            log(`output does not match with '${regexp}'`);
            if (passedTime < this.timeout) {
              iter(passedTime + this.timeStep);
            } else {
              const msg = `Waiting '${regexp}' was too long`;
              this.stop(msg);
            }
          }
        }, this.timeStep);

        log(`execute wait after ${this.timeStep}: ${regexp}`);
        iter();
      },
    });
    return this;
  }

  stop(msg) {
    this.msg = msg;
    this.term.destroy();
  }

  matchOutput(regexp) {
    let line;
    while (line = this.nextLine()) {
      const matches = regexp.exec(line);
      if (matches) {
        return matches;
      }
    }
    return null;
  }

  send(mix) {
    log(`send: ${mix}`);
    this.chain.push({
      type: 'send',
      payload: mix,
      func: () => {
        log(`execute send: ${mix}`);
        this.term.write(typeof mix === 'function' ? mix() : mix);
        setImmediate(() => this.executeNextAction());
      },
    });
    return this;
  }

  start() {
    log('start');
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;

      log('spawn bash');
      this.term = pty.spawn('bash');

      log(`execute '${this.programm}'`);
      this.term.write(`${this.programm}\n`);

      this.term.on('data', (data) => {
        const last = this.lines[this.lines.length - 1] || '';
        const lines = last === '' ? this.lines : this.lines.slice(0, -1);
        const firstStart = last === '' ? '' : this.lines[this.lines.length - 1];
        const [firstEnd, ...rest] = data.split(/\r\n/);

        this.lines = [...lines, `${firstStart}${firstEnd}`, ...rest];
      });

      this.term.on('exit', (code) => {
        log(`Got exit signal with code: ${code}`);
        if (this.state === 'fulfilled') {
          this.resolve(code);
        } else {
          this.reject(this.msg);
        }
      });

      this.executeNextAction();
    });
  }
}

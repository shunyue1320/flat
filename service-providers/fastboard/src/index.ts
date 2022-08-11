import { createFastboard, createUI, FastboardApp } from "@netless/fastboard";
import { DeviceType, RoomPhase } from "white-web-sdk";
import { RoomType } from "@netless/flat-server-api";
import type { FlatI18n } from "@netless/flat-i18n";
import {
    IServiceWhiteboard,
    IServiceWhiteboardJoinRoomConfig,
    IServiceWhiteboardPhase,
    Toaster,
} from "@netless/flat-services";
import { WindowManager } from "@netless/window-manager";
import { ReadonlyVal, Val, combine } from "value-enhancer";

declare global {
    interface Window {
        __netlessUA?: string;
    }
}

interface FlatInfo {
    readonly platform?: string;
    readonly version?: string;
    readonly region?: string;
    readonly ua?: string;
}

export interface FastboardConfig {
    APP_ID?: string;
    toaster: Toaster;
    flatI18n: FlatI18n;
    flatInfo?: FlatInfo;
}

export class Fastboard extends IServiceWhiteboard {
    private toaster: Toaster;
    private flatI18n: FlatI18n;
    private flatInfo: FlatInfo;
    private APP_ID?: string;
    private ui = createUI();

    public readonly _app$: Val<FastboardApp | null>;
    public readonly _el$: Val<HTMLElement | null>;
    public readonly _roomPhase$: Val<RoomPhase>;

    public readonly $Val: Readonly<{
        phase$: ReadonlyVal<IServiceWhiteboardPhase>;
        allowDrawing$: Val<boolean>;
    }>;

    public get roomID(): string | null {
        return this._app$.value?.room.uuid ?? null;
    }

    public get phase(): IServiceWhiteboardPhase {
        return this.$Val.phase$.value;
    }

    public get allowDrawing(): boolean {
        return this.$Val.allowDrawing$.value;
    }

    public setAllowDrawing(allowDrawing: boolean): void {
        this.$Val.allowDrawing$.setValue(allowDrawing);
    }

    public constructor({ APP_ID, toaster, flatI18n, flatInfo = {} }: FastboardConfig) {
        super();

        this.APP_ID = APP_ID;
        this.toaster = toaster;
        this.flatI18n = flatI18n;
        this.flatInfo = flatInfo;

        this._app$ = new Val<FastboardApp | null>(null);
        this._el$ = new Val<HTMLElement | null>(null);
        this._roomPhase$ = new Val<RoomPhase>(RoomPhase.Disconnected);
        const allowDrawing$ = new Val(false);

        const phase$ = combine([this._app$, this._roomPhase$], ([app, phase]) =>
            app ? convertRoomPhase(phase) : IServiceWhiteboardPhase.Disconnected,
        );

        this.$Val = {
            phase$,
            allowDrawing$,
        };
        this.sideEffect.push(() => {
            this._app$.destroy();
            this._el$.destroy();
            this._roomPhase$.destroy();
            phase$.destroy();
            allowDrawing$.destroy();
        });

        this.setUA();

        this.sideEffect.push([
            combine([this._app$, allowDrawing$]).subscribe(async ([app, allowDrawing]) => {
                const room = app?.room;
                if (!room) {
                    return;
                }
                room.disableDeviceInputs = !allowDrawing;
                if (allowDrawing && !room.isWritable) {
                    try {
                        await app.room.setWritable(true);
                    } catch (e) {
                        if (process.env.NODE_ENV !== "production") {
                            console.error(e);
                        }
                    }
                }
            }),
            this._el$.subscribe(el => (el ? this.ui.mount(el) : this.ui.destroy())),
            this._app$.subscribe(app => this.ui.update({ app })),
        ]);
    }

    public async joinRoom({
        appID = this.APP_ID,
        roomID,
        roomToken,
        uid,
        nickName,
        region,
        classroomType,
        allowDrawing,
    }: IServiceWhiteboardJoinRoomConfig): Promise<void> {
        if (!appID) {
            throw new Error("[Fastboard] APP_ID is not set");
        }

        if (this.roomID) {
            throw new Error(
                `[Fastboard] cannot join room '${roomID}', already joined '${this.roomID}'`,
            );
        }

        this.setAllowDrawing(allowDrawing);
        this._roomPhase$.setValue(RoomPhase.Disconnected);

        const fastboardAPP = await createFastboard({
            sdkConfig: {
                appIdentifier: appID,
                region,
                deviceType: DeviceType.Surface,
                pptParams: {
                    useServerWrap: true,
                },
            },
            managerConfig: {
                containerSizeRatio: classroomType === RoomType.SmallClass ? 8.3 / 16 : 10.46 / 16,
                cursor: true,
                chessboard: false,
                collectorStyles: {
                    position: "absolute",
                    bottom: "8px",
                },
            },
            joinRoom: {
                uuid: roomID,
                roomToken,
                region,
                userPayload: {
                    uid,
                    nickName,
                    // @deprecated
                    userId: uid,
                    // @deprecated
                    cursorName: nickName,
                },
                isWritable: allowDrawing,
                uid,
                floatBar: true,
                disableEraseImage: true,
                invisiblePlugins: [WindowManager],
                callbacks: {
                    onEnableWriteNowChanged: async () => {
                        const room = this._app$.value?.room;
                        if (!room) {
                            return;
                        }
                        if (room.isWritable) {
                            room.disableSerialization = false;
                        } else if (this.allowDrawing) {
                            room.setWritable(true);
                        }
                    },
                    onPhaseChanged: phase => {
                        this._roomPhase$.setValue(phase);
                    },
                    onDisconnectWithError: error => {
                        this.toaster.emit("error", this.flatI18n.t("on-disconnect-with-error"));
                        console.error(error);
                    },
                    onKickedWithReason: async reason => {
                        this.events.emit(
                            "kicked",
                            reason === "kickByAdmin"
                                ? "kickedByAdmin"
                                : reason === "roomDelete"
                                ? "roomDeleted"
                                : reason === "roomBan"
                                ? "roomBanned"
                                : "unknown",
                        );
                        try {
                            await this.leaveRoom();
                        } catch {
                            // already in exception state, ignore errors
                        }
                    },
                },
            },
        });
        this._app$.setValue(fastboardAPP);
    }

    public async leaveRoom(): Promise<void> {
        const app = this._app$.value;
        if (app) {
            this._app$.setValue(null);
            this._el$.setValue(null);
            this.ui.destroy();
            await app.destroy();
        }
    }

    public override render(el: HTMLElement): void {
        this._el$.setValue(el);
    }

    public override async destroy(): Promise<void> {
        super.destroy();
        await this.leaveRoom();
    }

    private setUA(): void {
        const exist = window.__netlessUA || "";
        if (!exist.includes("FLAT/")) {
            const ua =
                this.flatInfo.ua ||
                (this.flatI18n.t("app-name") || "").replace(/s+/g, "_").slice(0, 50);
            const platform = this.flatInfo.platform || "unknown";
            const region = this.flatInfo.region || "ROW";
            const version = this.flatInfo.version || "0.0.0";
            window.__netlessUA = exist + ` FLAT/${ua}_${platform}_${region}@${version} `;
        }
    }
}

function convertRoomPhase(roomPhase: RoomPhase): IServiceWhiteboardPhase {
    switch (roomPhase) {
        case RoomPhase.Connecting: {
            return IServiceWhiteboardPhase.Connecting;
        }
        case RoomPhase.Connected: {
            return IServiceWhiteboardPhase.Connected;
        }
        case RoomPhase.Reconnecting: {
            return IServiceWhiteboardPhase.Reconnecting;
        }
        case RoomPhase.Disconnecting: {
            return IServiceWhiteboardPhase.Disconnecting;
        }
        default: {
            return IServiceWhiteboardPhase.Disconnected;
        }
    }
}
import { Menu } from "antd";
import { observer } from "mobx-react-lite";
import React, { useState } from "react";
import { RoomStatus } from "../../apiMiddleware/flatServer/constants";
import { RoomItem } from "../../stores/RoomStore";
import { RemoveRoomModal } from "../Modal/RemoveRoomModal";

interface RemoveRoomItemProps {
    room: RoomItem | undefined;
    isCreator: boolean;
    onRemoveRoom?: (roomUUID: string | undefined) => void;
    autoPopupModal?: boolean;
}

export const RemoveRoomItem = observer<RemoveRoomItemProps>(function RemoveButton({
    isCreator,
    room,
    onRemoveRoom,
    ...restProps
}) {
    const [cancelModalVisible, setCancelModalVisible] = useState(false);

    if (isCreator && room?.roomStatus !== RoomStatus.Idle) {
        return null;
    }

    const title = isCreator ? "取消房间" : "移除房间";

    const hideCancelModal = (): void => {
        setCancelModalVisible(false);
    };

    return (
        <>
            <Menu.Item
                {...restProps}
                onClick={() => {
                    setCancelModalVisible(true);
                }}
            >
                {title}
            </Menu.Item>
            <RemoveRoomModal
                cancelModalVisible={cancelModalVisible}
                onCancel={hideCancelModal}
                isCreator={isCreator}
                onRemoveRoom={onRemoveRoom}
                roomUUID={room?.roomUUID}
                periodicUUID={room?.periodicUUID}
            />
        </>
    );
});
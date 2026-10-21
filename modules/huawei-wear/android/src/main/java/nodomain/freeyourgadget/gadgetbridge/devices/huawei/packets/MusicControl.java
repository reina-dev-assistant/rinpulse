/*  Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): the packet layout of
    app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/huawei/packets/MusicControl.java
    (Copyright (C) 2024 Damien Gaignon, Martin.JM). Only the three commands remote control needs are ported:
    MusicStatus (0x01, the watch asking to be told), MusicInfo (0x02, phone -> watch) and Control (0x03,
    watch -> phone). Upload, list and playlist commands (0x04, 0x05, 0x08, 0x09, 0x0D) are deliberately
    absent: the Watch Fit 1 has no on-board music storage, so there is nothing to upload or list. */

package nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets;

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV;

/** GB `packets/MusicControl`: what the watch shows of the phone's playback, and the buttons it sends back. */
public class MusicControl {
    /** The service id; it is `0x25` in GB's `HuaweiState`. */
    public static final byte id = 0x25;

    /** GB `MusicControl.successValue`: the `7f` an accepted request is answered with. */
    public static final int successValue = 0x000186A0;

    /** `25/01`: the watch asks for the current track (GB answers with a status and a MusicInfo). */
    public static final byte MUSIC_STATUS = 0x01;

    /** `25/02`: the track the phone plays. */
    public static final byte MUSIC_INFO = 0x02;

    /** `25/03`: a button the wearer pressed. */
    public static final byte CONTROL = 0x03;

    /** Tag `7f` carries the result code. */
    public static final int RESULT_TAG = 0x7F;

    /**
     * Play state GB sends in MusicInfo's tag `03`. GB's `SetMusicRequest.convertMusicState` passes Android's
     * `PlaybackState` codes straight through, so these are that enum's values, not an invented ordering.
     */
    public static class PlayState {
        public static final byte NONE = 0;
        public static final byte STOP = 1;
        public static final byte PAUSE = 2;
        public static final byte START = 3;
    }

    /**
     * `25/01` MusicStatus, answered with a {@link StatusRequest} on the same command id. The watch sends it when
     * its music screen opens, expecting the phone to push the track.
     */
    public static class MusicStatus extends HuaweiPacket {
        public int status = -1;

        public MusicStatus(ParamsProvider paramsProvider) {
            super(paramsProvider);

            this.serviceId = MusicControl.id;
            this.commandId = MUSIC_STATUS;

            this.isEncrypted = false;
        }

        @Override
        public void parseTlv() throws ParseException {
            if (this.tlv != null && this.tlv.contains(RESULT_TAG)) {
                Integer value = this.tlv.getInteger(RESULT_TAG, null);
                if (value != null)
                    this.status = value;
            }
        }
    }

    /**
     * GB's `MusicStatusRequest`: `7f` = {@link #successValue} on whichever command id it answers. Sent both for
     * `25/01` (the watch asked) and for `25/03` (after acting on a button), which is what GB does.
     */
    public static class StatusRequest extends HuaweiPacket {
        public StatusRequest(ParamsProvider paramsProvider, byte commandId) {
            this(paramsProvider, commandId, successValue);
        }

        public StatusRequest(ParamsProvider paramsProvider, byte commandId, int returnValue) {
            super(paramsProvider);

            this.serviceId = MusicControl.id;
            this.commandId = commandId;

            this.tlv = new HuaweiTLV()
                    .put(RESULT_TAG, returnValue);

            this.isEncrypted = true;
            this.complete = true;
        }
    }

    /**
     * `25/02` MusicInfo, <b>phone to watch</b>: the track the phone is playing. Encrypted; the watch answers `7f`.
     * Tags: `01` artist, `02` song, `03` play state, `04` max volume, `05` current volume.
     */
    public static class MusicInfo extends HuaweiPacket {
        public MusicInfo(ParamsProvider paramsProvider, String artist, String song, byte playState, byte maxVolume, byte currentVolume) {
            super(paramsProvider);

            this.serviceId = MusicControl.id;
            this.commandId = MUSIC_INFO;

            this.tlv = new HuaweiTLV()
                    .put(0x01, artist)
                    .put(0x02, song)
                    .put(0x03, playState)
                    .put(0x04, maxVolume)
                    .put(0x05, currentVolume);

            this.isEncrypted = true;
            this.complete = true;
        }

        /** The watch's receipt; only `7f` is read, and only to log whether it took the track. */
        public static class Response extends HuaweiPacket {
            public boolean ok = false;
            public String detail = "no status tag";

            public Response(ParamsProvider paramsProvider) {
                super(paramsProvider);

                this.serviceId = MusicControl.id;
                this.commandId = MUSIC_INFO;

                this.isEncrypted = true;
            }

            @Override
            public void parseTlv() throws ParseException {
                Integer value = null;
                if (this.tlv != null && this.tlv.contains(RESULT_TAG) && this.tlv.getBytes(RESULT_TAG).length == 4)
                    value = this.tlv.getInteger(RESULT_TAG);

                if (value == null) {
                    this.ok = false;
                    this.detail = "no status tag";
                } else if (value == successValue) {
                    this.ok = true;
                    this.detail = "";
                } else {
                    this.ok = false;
                    this.detail = String.format("status 0x%08x", value);
                }
            }
        }
    }

    /**
     * `25/03` Control, <b>watch to phone</b>: a button the wearer pressed. <b>Not encrypted</b> (GB's
     * `Control.Response` sets `isEncrypted = false`). Tags: `01` button, `02` volume.
     *
     * <p>The watch sends this unprompted, so it is a packet to <i>read</i>, not a command the watch has to
     * advertise in SupportedCommands — which is why a watch listing only `25/02` still reports its buttons.
     */
    public static class Control extends HuaweiPacket {
        public Button button = null;
        public boolean buttonPresent = false;
        public boolean volumePresent = false;
        public int volume = 0;
        /** The raw byte, kept so the log can name what GB refuses to map (64, and 100 = left the screen). */
        public int rawButton = 0;

        public Control(ParamsProvider paramsProvider) {
            super(paramsProvider);

            this.serviceId = MusicControl.id;
            this.commandId = CONTROL;

            this.isEncrypted = false;
        }

        @Override
        public void parseTlv() throws ParseException {
            if (this.tlv == null)
                return;

            if (this.tlv.contains(0x01)) {
                this.buttonPresent = true;
                // Only the lowest byte is read, as GB does.
                byte[] bytes = this.tlv.getBytes(0x01);
                this.rawButton = bytes[bytes.length - 1] & 0xFF;
                switch (this.rawButton) {
                    case 1:
                        this.button = Button.Play;
                        break;
                    case 2:
                        this.button = Button.Pause;
                        break;
                    case 3:
                        this.button = Button.Previous;
                        break;
                    case 4:
                        this.button = Button.Next;
                        break;
                    case 5:
                        this.button = Button.Volume_up;
                        break;
                    case 6:
                        this.button = Button.Volume_down;
                        break;
                    case 64:
                        // Unknown button on Huawei Band 4: GB falls through to the 100 case.
                    case 100:
                        // Exit from the music screen. GB does not treat it as a button at all: it clears
                        // buttonPresent, so no action runs and (with no volume) nothing is even acknowledged.
                        this.buttonPresent = false;
                    default:
                        this.button = Button.Unknown;
                }
            }

            if (this.tlv.contains(0x02)) {
                this.volumePresent = true;
                // Only the lowest byte is read, as GB does.
                byte[] bytes = this.tlv.getBytes(0x02);
                this.volume = bytes[bytes.length - 1] & 0xFF;
            }
        }

        /** GB's `Control.Response.Button`: the raw byte for the six buttons, plus its catch-all. */
        public enum Button {
            Unknown(64),
            Play(1),
            Pause(2),
            Previous(3),
            Next(4),
            Volume_up(5),
            Volume_down(6);

            public final int raw;

            Button(int raw) {
                this.raw = raw;
            }

            /** GB's `parseTlv` maps only 1..6; everything else ends up as {@link #Unknown}. */
            public static Button of(int raw) {
                for (Button button : values()) {
                    if (button.raw == raw)
                        return button;
                }
                return Unknown;
            }
        }
    }
}

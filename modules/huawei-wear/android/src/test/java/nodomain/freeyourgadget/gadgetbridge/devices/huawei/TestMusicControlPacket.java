/*  Tests for the music packets in Gadgetbridge's own package, so the `protected isEncrypted` field is reachable
    (it decides whether a packet is encrypted on the wire, and a wrong value is what would make 25/03 look dead).
    Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE). */

package nodomain.freeyourgadget.gadgetbridge.devices.huawei;

import org.junit.Assert;
import org.junit.Test;

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.MusicControl;

public class TestMusicControlPacket {

    private final HuaweiPacket.ParamsProvider params = new HuaweiPacket.ParamsProvider();

    /** GB's MusicControl.Control.Response sets isEncrypted = false: 25/03 is read in the clear. */
    @Test
    public void controlIsNotEncrypted() {
        MusicControl.Control control = new MusicControl.Control(params);
        Assert.assertFalse("25/03 must be read unencrypted", control.isEncrypted);
    }

    /** MusicInfo is encrypted, like GB's MusicControl.MusicInfo.Request. */
    @Test
    public void musicInfoIsEncryptedAndComplete() {
        MusicControl.MusicInfo info = new MusicControl.MusicInfo(params, "A", "L", MusicControl.PlayState.START, (byte) 15, (byte) 7);
        Assert.assertTrue(info.isEncrypted);
        Assert.assertTrue("must be complete to be sent", info.complete);
    }

    /** The id of the service the watch advertises in SupportedCommands as "25". */
    @Test
    public void serviceIdIs25() {
        Assert.assertEquals(0x25, MusicControl.id);
        Assert.assertEquals(0x01, MusicControl.MUSIC_STATUS);
        Assert.assertEquals(0x02, MusicControl.MUSIC_INFO);
        Assert.assertEquals(0x03, MusicControl.CONTROL);
    }

    /** The ack GB sends back for both 25/01 and 25/03: tag 7f = successValue, encrypted. */
    @Test
    public void statusRequestCarriesSuccessOnTheSameCommand() throws Exception {
        MusicControl.StatusRequest status = new MusicControl.StatusRequest(params, MusicControl.MUSIC_STATUS);
        Assert.assertEquals(MusicControl.MUSIC_STATUS, status.commandId);
        Assert.assertEquals(MusicControl.successValue, status.tlv.getInteger(0x7F).intValue());
        Assert.assertTrue(status.isEncrypted);
        Assert.assertTrue(status.complete);
    }

    /** MusicInfo's tags are the ones GB's MusicControl.MusicInfo.Request writes. */
    @Test
    public void musicInfoTagsMatchGadgetbridge() throws Exception {
        MusicControl.MusicInfo info = new MusicControl.MusicInfo(params, "Artis", "Lagu", MusicControl.PlayState.PAUSE, (byte) 15, (byte) 9);
        Assert.assertEquals("Artis", info.tlv.getString(0x01));
        Assert.assertEquals("Lagu", info.tlv.getString(0x02));
        Assert.assertEquals(MusicControl.PlayState.PAUSE, info.tlv.getByte(0x03).byteValue());
        Assert.assertEquals(15, info.tlv.getByte(0x04).byteValue());
        Assert.assertEquals(9, info.tlv.getByte(0x05).byteValue());
    }
}

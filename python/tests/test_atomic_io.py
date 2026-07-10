"""atomic_write_bytes 单元测试: 基本写入 + 非 ASCII 往返 + 覆盖写 + 父目录缺失场景。"""
import os
import tempfile
import unittest
from pathlib import Path

from tools.atomic_io import atomic_write_bytes


class AtomicWriteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.mkdtemp(prefix="atomic_io_test_")
        self.addCleanup(self._cleanup)

    def _cleanup(self) -> None:
        for entry in os.listdir(self.tmpdir):
            full = os.path.join(self.tmpdir, entry)
            try:
                os.unlink(full)
            except OSError:
                pass
        os.rmdir(self.tmpdir)

    def test_writes_bytes(self) -> None:
        path = Path(self.tmpdir) / "out.bin"
        atomic_write_bytes(path, b"\x00\x01\x02hello")
        self.assertEqual(path.read_bytes(), b"\x00\x01\x02hello")

    def test_overwrites_existing(self) -> None:
        path = Path(self.tmpdir) / "out.txt"
        path.write_bytes(b"old content")
        atomic_write_bytes(path, b"new")
        self.assertEqual(path.read_bytes(), b"new")

    def test_non_ascii_chinese_round_trip(self) -> None:
        path = Path(self.tmpdir) / "zh.txt"
        text = "节点「姬子」测试中文"
        atomic_write_bytes(path, text.encode("utf-8"))
        self.assertEqual(path.read_bytes().decode("utf-8"), text)

    def test_emoji_round_trip(self) -> None:
        path = Path(self.tmpdir) / "emoji.bin"
        text = "工具合并 🛠️✨"
        atomic_write_bytes(path, text.encode("utf-8"))
        self.assertEqual(path.read_bytes().decode("utf-8"), text)

    def test_cleans_up_tmp_on_failure(self) -> None:
        # 父目录不存在时 mkstemp 失败, 不应残留临时文件
        missing_parent = Path(self.tmpdir) / "missing" / "out.bin"
        with self.assertRaises(OSError):
            atomic_write_bytes(missing_parent, b"data")
        # tmpdir 里不应有残留的 .tmp 文件
        leftover = [n for n in os.listdir(self.tmpdir) if n.endswith(".tmp")]
        self.assertEqual(leftover, [])


if __name__ == "__main__":
    unittest.main()

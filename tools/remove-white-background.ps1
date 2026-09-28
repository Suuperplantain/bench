param(
  [Parameter(Mandatory = $true)]
  [string] $InputPath,

  [Parameter(Mandatory = $true)]
  [string] $OutputPath,

  [ValidateRange(0, 255)]
  [int] $Tolerance = 65
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$inputFile = (Resolve-Path -LiteralPath $InputPath).Path
$outputFile = [System.IO.Path]::GetFullPath($OutputPath)
if ([string]::Equals($inputFile, $outputFile, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Choose a different OutputPath so the original image is kept intact.'
}
if ([System.IO.Path]::GetExtension($outputFile) -ne '.png') {
  throw 'OutputPath must end in .png so transparency is preserved.'
}
if (-not [System.IO.Directory]::Exists([System.IO.Path]::GetDirectoryName($outputFile))) {
  throw 'The output folder does not exist.'
}

$source = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class WhiteBackgroundCutout
{
    private static byte[] pixels;
    private static bool[] visited;
    private static int[] queue;
    private static int width;
    private static int height;
    private static int stride;
    private static int toleranceSquared;
    private static int tail;

    private static bool IsNearWhite(int offset)
    {
        int blue = 255 - pixels[offset];
        int green = 255 - pixels[offset + 1];
        int red = 255 - pixels[offset + 2];
        return blue * blue + green * green + red * red <= toleranceSquared;
    }

    private static void TryQueue(int x, int y)
    {
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        int pixelIndex = y * width + x;
        if (visited[pixelIndex]) return;
        visited[pixelIndex] = true;
        int offset = y * stride + x * 4;
        if (pixels[offset + 3] == 0 || !IsNearWhite(offset)) return;
        queue[tail++] = pixelIndex;
    }

    public static void Run(string input, string output, int tolerance)
    {
        using (Bitmap original = new Bitmap(input))
        using (Bitmap bitmap = new Bitmap(original.Width, original.Height, PixelFormat.Format32bppArgb))
        {
            width = bitmap.Width;
            height = bitmap.Height;
            toleranceSquared = tolerance * tolerance;
            using (Graphics graphics = Graphics.FromImage(bitmap))
                graphics.DrawImage(original, new Rectangle(0, 0, width, height));

            Rectangle bounds = new Rectangle(0, 0, width, height);
            BitmapData data = bitmap.LockBits(bounds, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
            try
            {
                stride = data.Stride;
                pixels = new byte[stride * height];
                Marshal.Copy(data.Scan0, pixels, 0, pixels.Length);
                visited = new bool[width * height];
                queue = new int[width * height];
                tail = 0;

                for (int x = 0; x < width; x++)
                {
                    TryQueue(x, 0);
                    TryQueue(x, height - 1);
                }
                for (int y = 1; y < height - 1; y++)
                {
                    TryQueue(0, y);
                    TryQueue(width - 1, y);
                }

                int head = 0;
                while (head < tail)
                {
                    int index = queue[head++];
                    int x = index % width;
                    int y = index / width;
                    pixels[y * stride + x * 4 + 3] = 0;
                    TryQueue(x - 1, y - 1); TryQueue(x, y - 1); TryQueue(x + 1, y - 1);
                    TryQueue(x - 1, y);                             TryQueue(x + 1, y);
                    TryQueue(x - 1, y + 1); TryQueue(x, y + 1); TryQueue(x + 1, y + 1);
                }

                Marshal.Copy(pixels, 0, data.Scan0, pixels.Length);
            }
            finally
            {
                bitmap.UnlockBits(data);
            }
            bitmap.Save(output, ImageFormat.Png);
        }
    }
}
'@

$drawingAssembly = [System.Drawing.Bitmap].Assembly
$references = @(
  $drawingAssembly.Location,
  [System.Drawing.Rectangle].Assembly.Location,
  [System.Runtime.InteropServices.Marshal].Assembly.Location
)
$assemblyFolder = [System.IO.Path]::GetDirectoryName($drawingAssembly.Location)
foreach ($reference in $drawingAssembly.GetReferencedAssemblies()) {
  $referencePath = Join-Path $assemblyFolder ($reference.Name + '.dll')
  if (Test-Path -LiteralPath $referencePath) { $references += $referencePath }
}
Add-Type -TypeDefinition $source -ReferencedAssemblies $references
[WhiteBackgroundCutout]::Run($inputFile, $outputFile, $Tolerance)
Write-Output "Saved transparent PNG: $outputFile"

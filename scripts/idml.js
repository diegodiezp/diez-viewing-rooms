// InDesign export of the pdf2 layout, as an IDML package: a .zip with
// "<name>.idml" and a "Links" folder with every image, the same way InDesign
// packages a document. Open the .idml in InDesign; text stays editable with
// named paragraph styles (Artist, Title, Medium, ...) in Replica Pro, and the
// images are linked from the Links folder next to it.
//
// IDML is InDesign's open XML format (a zip of XML files). This writes the
// minimum InDesign needs: document, preferences, colours, fonts, styles, one
// spread per page and one story per text frame.
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { zipSync, strToU8 } = require("fflate");
const { layout } = require("../api/_lib/pdf2");

const { P, CAPTION_W, CAPTION_BOTTOM, captionLines, priceText } = layout;
const NS = 'xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="8.0"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const H2 = P.h / 2;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (v) => (Math.round(v * 1000) / 1000).toString();

// ---------------------------------------------------------------- styles
const COLORS = {
  Ink: [26, 26, 26], Soft: [68, 68, 68], Grey: [143, 143, 143], Status: [119, 119, 119], Link: [79, 82, 217],
};
// name: [font style, size, leading, colour, extra attributes]
const PSTYLES = {
  "Cover title": ["Bold", 58, 52, "Ink", ""],
  "Cover artists": ["Bold", 26, 31, "Ink", 'SpaceBefore="12"'],
  "Cover dates": ["Bold", 15, 18, "Ink", 'SpaceBefore="18"'],
  "Artist": ["Bold", 11, 13.2, "Ink", ""],
  "Title": ["Italic", 11, 13.2, "Ink", 'SpaceBefore="1"'],
  "Medium": ["Regular", 8.5, 10.2, "Soft", 'SpaceBefore="10"'],
  "Dimensions": ["Regular", 8.5, 10.2, "Soft", 'SpaceBefore="3"'],
  "Price": ["Bold", 9, 10.8, "Ink", 'SpaceBefore="12"'],
  "Status": ["Regular", 7.5, 9, "Status", 'SpaceBefore="4" Tracking="130"'],
  "Centred artist": ["Italic", 11.5, 13.8, "Ink", 'Justification="CenterAlign"'],
  "Centred title": ["Italic", 11.5, 13.8, "Ink", 'Justification="CenterAlign" SpaceBefore="1"'],
  "Centred details": ["Regular", 9, 13, "Ink", 'Justification="CenterAlign" SpaceBefore="4"'],
  "Centred price": ["Bold", 9, 10.8, "Ink", 'Justification="CenterAlign" SpaceBefore="12"'],
  "Centred status": ["Regular", 7.5, 9, "Status", 'Justification="CenterAlign" SpaceBefore="3" Tracking="130"'],
  "Contact": ["Regular", 6.5, 7.8, "Grey", ""],
  "Contact right": ["Regular", 6.5, 7.8, "Grey", 'Justification="RightAlign"'],
  "Body": ["Regular", 11, 16.6, "Ink", 'Justification="LeftJustified" SpaceAfter="14"'],
  "Closing": ["Bold", 15, 18, "Ink", ""],
  "Closing contact": ["Regular", 15, 18, "Ink", ""],
  "Closing link": ["Regular", 15, 18, "Link", 'Underline="true"'],
};
// pdf2 caption fonts -> paragraph styles (wall pages, caption bottom left)
function captionStyle(line, i) {
  const [font, size, , , gap] = line;
  if (i === 0 && font === "Replica-Bold" && size === 11) return "Artist";
  if (font === "Replica-Italic") return "Title";
  if (font === "Replica-Bold") return "Price";
  if (size === 7.5) return "Status";
  return gap >= 10 ? "Medium" : "Dimensions";
}

function graphicXml() {
  const colors = Object.entries(COLORS).map(([n, [r, g, b]]) =>
    `<Color Self="Color/${n}" Model="Process" Space="RGB" ColorValue="${r} ${g} ${b}" ColorOverride="Normal" AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="Diez ${n}" ColorEditable="true" ColorRemovable="true" Visible="true" SwatchCreatorID="7937"/>`).join("\n  ");
  return HEAD + `<idPkg:Graphic ${NS}>
  <Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100" ColorOverride="Specialblack" AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="Black" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>
  <Color Self="Color/Paper" Model="Process" Space="CMYK" ColorValue="0 0 0 0" ColorOverride="Specialpaper" AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="Paper" ColorEditable="true" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>
  <Color Self="Color/Registration" Model="Registration" Space="CMYK" ColorValue="100 100 100 100" ColorOverride="Specialregistration" AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="Registration" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>
  ${colors}
  <Swatch Self="Swatch/None" Name="None" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>
  <StrokeStyle Self="StrokeStyle/$ID/Solid" Name="$ID/Solid"/>
</idPkg:Graphic>`;
}

function fontsXml() {
  const f = (style) => `<Font Self="di1Font${style}" FontFamily="Replica Pro" Name="Replica Pro ${style}" PostScriptName="ReplicaPro-${style}" Status="Installed" FontStyleName="${style}" FontType="OpenTypeCFF" WritingScript="0" FullName="Replica Pro ${style}" FullNameNative="Replica Pro ${style}" FontStyleNameNative="${style}" PlatformName="$ID/" Version=""/>`;
  return HEAD + `<idPkg:Fonts ${NS}>
  <FontFamily Self="di1" Name="Replica Pro">
    ${f("Regular")}
    ${f("Italic")}
    ${f("Bold")}
  </FontFamily>
</idPkg:Fonts>`;
}

function stylesXml() {
  const ps = Object.entries(PSTYLES).map(([name, [style, size, lead, color, extra]]) =>
    `<ParagraphStyle Self="ParagraphStyle/${esc(name)}" Name="${esc(name)}" Imported="false" NextStyle="ParagraphStyle/${esc(name)}" FontStyle="${style}" PointSize="${size}" FillColor="Color/${color}" Hyphenation="false" KeyboardShortcut="0 0" ${extra}>
      <Properties><BasedOn type="string">$ID/[No paragraph style]</BasedOn><AppliedFont type="string">Replica Pro</AppliedFont><Leading type="unit">${lead}</Leading></Properties>
    </ParagraphStyle>`).join("\n    ");
  return HEAD + `<idPkg:Styles ${NS}>
  <RootCharacterStyleGroup Self="u_rcs">
    <CharacterStyle Self="CharacterStyle/$ID/[No character style]" Imported="false" Name="$ID/[No character style]"/>
  </RootCharacterStyleGroup>
  <RootParagraphStyleGroup Self="u_rps">
    <ParagraphStyle Self="ParagraphStyle/$ID/[No paragraph style]" Name="$ID/[No paragraph style]" Imported="false" FontStyle="Regular" PointSize="12" FillColor="Color/Black">
      <Properties><AppliedFont type="string">Replica Pro</AppliedFont><Leading type="enumeration">Auto</Leading></Properties>
    </ParagraphStyle>
    <ParagraphStyle Self="ParagraphStyle/$ID/NormalParagraphStyle" Name="$ID/NormalParagraphStyle" Imported="false" NextStyle="ParagraphStyle/$ID/NormalParagraphStyle" KeyboardShortcut="0 0">
      <Properties><BasedOn type="string">$ID/[No paragraph style]</BasedOn></Properties>
    </ParagraphStyle>
    ${ps}
  </RootParagraphStyleGroup>
  <RootCellStyleGroup Self="u_rcl"><CellStyle Self="CellStyle/$ID/[None]" Name="$ID/[None]"/></RootCellStyleGroup>
  <RootTableStyleGroup Self="u_rts">
    <TableStyle Self="TableStyle/$ID/[No table style]" Name="$ID/[No table style]"/>
    <TableStyle Self="TableStyle/$ID/[Basic Table]" Name="$ID/[Basic Table]"/>
  </RootTableStyleGroup>
  <RootObjectStyleGroup Self="u_ros">
    <ObjectStyle Self="ObjectStyle/$ID/[None]" Name="$ID/[None]" FillColor="Swatch/None" StrokeColor="Swatch/None" StrokeWeight="0"/>
    <ObjectStyle Self="ObjectStyle/$ID/[Normal Graphics Frame]" Name="$ID/[Normal Graphics Frame]" FillColor="Swatch/None" StrokeColor="Swatch/None" StrokeWeight="0"/>
    <ObjectStyle Self="ObjectStyle/$ID/[Normal Text Frame]" Name="$ID/[Normal Text Frame]" FillColor="Swatch/None" StrokeColor="Swatch/None" StrokeWeight="0"/>
  </RootObjectStyleGroup>
</idPkg:Styles>`;
}

function preferencesXml(pageCount) {
  return HEAD + `<idPkg:Preferences ${NS}>
  <DocumentPreference PageHeight="${P.h}" PageWidth="${P.w}" PagesPerDocument="${pageCount}" FacingPages="false" DocumentBleedTopOffset="0" DocumentBleedBottomOffset="0" DocumentBleedInsideOrLeftOffset="0" DocumentBleedOutsideOrRightOffset="0" DocumentBleedUniformSize="true" AllowPageShuffle="true" PageBinding="LeftToRight" ColumnDirection="Horizontal" Intent="WebIntent"/>
  <MarginPreference ColumnCount="1" ColumnGutter="12" Top="36" Bottom="36" Left="36" Right="36" ColumnDirection="Horizontal" ColumnsPositions="0 ${P.w - 72}"/>
  <ViewPreference HorizontalMeasurementUnits="Millimeters" VerticalMeasurementUnits="Millimeters" PointsPerInch="72"/>
</idPkg:Preferences>`;
}

// ---------------------------------------------------------------- geometry
// Page coordinates (from the top-left corner, in points) -> spread
// coordinates (single-page spreads: origin at the page's left edge, halfway
// down).
function pathXml(x, y, w, h) {
  const pts = [[x, y], [x, y + h], [x + w, y + h], [x + w, y]]
    .map(([px, py]) => { const a = num(px) + " " + num(py - H2); return `<PathPointType Anchor="${a}" LeftDirection="${a}" RightDirection="${a}"/>`; })
    .join("");
  return `<Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>${pts}</PathPointArray></GeometryPathType></PathGeometry></Properties>`;
}

// ---------------------------------------------------------------- builder
async function buildIdml(model, name) {
  const { room, participants, items, imgs, walls, introParas } = model;
  let uid = 0;
  const id = (p) => p + (++uid).toString(36);
  const links = {};      // file name -> Buffer
  const stories = [];    // [selfId, xml]
  const spreads = [];    // [selfId, xml]
  let pageNo = 0;

  async function link(buf, base) {
    const meta = await sharp(buf).metadata();
    const ext = meta.format === "png" ? "png" : "jpg";
    const file = base + "." + ext;
    links[file] = buf;
    const dpi = meta.density || 72;
    return { file, w: meta.width * 72 / dpi, h: meta.height * 72 / dpi, format: ext === "png" ? "$ID/Portable Network Graphics (PNG)" : "$ID/JPEG" };
  }

  // Graphic frame (x, y, w, h on the page) holding an image placed at
  // (ix, iy) with size (iw, ih); the frame crops whatever falls outside.
  function imageFrame(img, x, y, w, h, ix, iy, iw, ih) {
    const s = iw / img.w;
    return `<Rectangle Self="${id("r")}" ContentType="GraphicType" ItemTransform="1 0 0 1 0 0" AppliedObjectStyle="ObjectStyle/$ID/[Normal Graphics Frame]" FillColor="Swatch/None" StrokeColor="Swatch/None" StrokeWeight="0">
      ${pathXml(x, y, w, h)}
      <FrameFittingOption AutoFit="false"/>
      <Image Self="${id("i")}" ItemTransform="${num(s)} 0 0 ${num(ih / img.h)} ${num(ix)} ${num(iy - H2)}">
        <Properties><Profile type="string">$ID/None</Profile><GraphicBounds Left="0" Top="0" Right="${num(img.w)}" Bottom="${num(img.h)}"/></Properties>
        <Link Self="${id("l")}" AssetURL="$ID/" AssetID="$ID/" LinkResourceURI="file:Links/${img.file}" LinkResourceFormat="${img.format}" StoredState="Normal" LinkClassID="35906" LinkClientID="257" LinkResourceModified="false" LinkObjectModified="false" ShowInUI="true" CanEmbed="true" CanUnembed="true" CanPackage="true" ImportPolicy="NoAutoImport" ExportPolicy="NoAutoExport" LinkImportStamp="" LinkImportModificationTime="" LinkImportTime=""/>
      </Image>
    </Rectangle>`;
  }
  const fitIn = (img, x, y, w, h) => {
    const s = Math.min(w / img.w, h / img.h), iw = img.w * s, ih = img.h * s;
    return imageFrame(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  };
  const cover = (img, x, y, w, h) => {
    const s = Math.max(w / img.w, h / img.h), iw = img.w * s, ih = img.h * s;
    return imageFrame(img, x, y, w, h, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  };

  // Text frame with one story: paras = [[style, text], ...]
  function textFrame(x, y, w, h, paras, valign = "TopAlign") {
    const sid = id("st");
    const body = paras.map(([style, text], i) =>
      `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/${esc(style)}"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>${esc(text)}</Content>${i < paras.length - 1 ? "<Br/>" : ""}</CharacterStyleRange></ParagraphStyleRange>`).join("\n    ");
    stories.push([sid, HEAD + `<idPkg:Story ${NS}>
  <Story Self="${sid}" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n">
    <StoryPreference OpticalMarginAlignment="false" OpticalMarginSize="12" FrameType="TextFrameType" StoryOrientation="Horizontal" StoryDirection="LeftToRightDirection"/>
    ${body}
  </Story>
</idPkg:Story>`]);
    return `<TextFrame Self="${id("tf")}" ParentStory="${sid}" PreviousTextFrame="n" NextTextFrame="n" ContentType="TextType" ItemTransform="1 0 0 1 0 0" AppliedObjectStyle="ObjectStyle/$ID/[Normal Text Frame]" FillColor="Swatch/None" StrokeColor="Swatch/None" StrokeWeight="0">
      ${pathXml(x, y, w, h)}
      <TextFramePreference TextColumnCount="1" VerticalJustification="${valign}" AutoSizingType="Off" InsetSpacing="0 0 0 0"/>
    </TextFrame>`;
  }

  function page(content) {
    pageNo++;
    const sid = id("sp");
    spreads.push([sid, HEAD + `<idPkg:Spread ${NS}>
  <Spread Self="${sid}" PageCount="1" BindingLocation="0" AllowPageShuffle="true" ItemTransform="1 0 0 1 0 0" ShowMasterItems="true" PageTransitionType="None">
    <Page Self="${id("pg")}" Name="${pageNo}" AppliedMaster="n" OverrideList="" TabOrder="" GridStartingPoint="TopOutside" UseMasterGrid="true" GeometricBounds="0 0 ${P.h} ${P.w}" ItemTransform="1 0 0 1 0 ${num(-H2)}" MasterPageTransform="1 0 0 1 0 0">
      <MarginPreference ColumnCount="1" ColumnGutter="12" Top="36" Bottom="36" Left="36" Right="36" ColumnDirection="Horizontal" ColumnsPositions="0 ${P.w - 72}"/>
    </Page>
    ${content.join("\n    ")}
  </Spread>
</idPkg:Spread>`]);
  }

  const logoBuf = await sharp(path.join(__dirname, "..", "files", "logo.png")).withMetadata({ density: 72 }).png().toBuffer();
  const logo = await link(logoBuf, "diez-logo");
  const logoAt = (x, y, w) => imageFrame(logo, x, y, w, w * logo.h / logo.w, x, y, w, w * logo.h / logo.w);
  const CONTACT = "Gibraltarstraat 74-B, Amsterdam   ·   diego@diez.gallery   ·   +31 6 33261845   ·   diez.gallery";

  // ---- pages, in the same order as pdf2
  const titlePage = () => {
    const paras = [["Cover title", room.title]];
    if (participants.length) paras.push(["Cover artists", participants.join(", ")]);
    if (room.datesLong) paras.push(["Cover dates", room.datesLong]);
    page([textFrame(P.m, 22, 470, 440, paras), logoAt(P.m, P.h - 80, 94)]);
  };

  let titleDone = false, viewNo = 0, workNo = 0;
  const firstViewIdx = items.findIndex((it) => it.kind === "view");
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === "view") {
      const content = [];
      if (imgs[i]) {
        const img = await link(imgs[i], "view-" + String(++viewNo).padStart(2, "0"));
        content.push(img.w >= img.h ? cover(img, 0, 0, P.w, P.h) : fitIn(img, 0, 16, P.w, P.h - 32));
      }
      page(content);
      if (i === firstViewIdx) { titlePage(); titleDone = true; }
      continue;
    }
    if (!titleDone) { titlePage(); titleDone = true; }
    const w = it.work;
    const tag = "work-" + String(++workNo).padStart(2, "0");
    if (walls[i]) {
      // Extended-wall page: the wall image already contains the photo.
      const wall = await link(walls[i], tag + "-wall");
      const lines = captionLines(w);
      page([
        imageFrame(wall, 0, 0, P.w, P.h, 0, 0, P.w, P.h),
        logoAt(P.m, 20, 32),
        textFrame(P.m, 260, CAPTION_W, CAPTION_BOTTOM - 260, lines.map((ln, k) => [captionStyle(ln, k), ln[3]]), "BottomAlign"),
        textFrame(P.w - P.m - 420, P.h - 24, 420, 10, [["Contact right", CONTACT]]),
      ]);
    } else {
      const content = [];
      if (imgs[i]) content.push(fitIn(await link(imgs[i], tag), 126, 36, 590, 392));
      const paras = [];
      if (w.artist) paras.push(["Centred artist", w.artist]);
      paras.push(["Centred title", w.title + (w.year ? ", " + w.year : "")]);
      if (w.medium) paras.push(["Centred details", w.medium]);
      w.lines.forEach((ln) => paras.push(["Centred details", ln]));
      if (w.price && w.showPrice) paras.push(["Centred price", priceText(w)]);
      if (w.statusLabel !== "Available") paras.push(["Centred status", w.statusLabel.toUpperCase()]);
      content.push(textFrame((P.w - 560) / 2, 448, 560, 112, paras));
      content.push(logoAt(P.m, 20, 32));
      content.push(textFrame(P.m, P.h - 24, 420, 10, [["Contact", CONTACT]]));
      page(content);
    }
  }
  if (!titleDone) titlePage();
  if (introParas.length) page([textFrame(P.m, 40, 405, P.h - 80, introParas.map((t) => ["Body", t]))]);
  page([
    textFrame(P.m, 40, 600, 60, [["Closing", "All prices exclude 9% VAT and exclude shipping"], ["Closing", "Works subject to availability"]]),
    textFrame(P.m, 190, 600, 120, [["Closing link", "diego@diez.gallery"], ["Closing contact", "+31 6 33261845"], ["Closing contact", ""], ["Closing link", "@diez.gallery"], ["Closing link", "www.diez.gallery"]]),
    logoAt(P.m, P.h - 80, 94),
  ]);

  // ---- package
  const backing = HEAD + `<idPkg:BackingStory ${NS}>
  <XmlStory Self="u_bs" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n">
    <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"/></ParagraphStyleRange>
  </XmlStory>
</idPkg:BackingStory>`;
  const designmap = HEAD + `<?aid style="50" type="document" readerVersion="6.0" featureSet="257" product="8.0(370)" ?>
<Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="8.0" Self="d" StoryList="${stories.map((s) => s[0]).join(" ")} u_bs" Name="${esc(name)}.indd" ZeroPoint="0 0" ActiveLayer="u_layer" CMYKProfile="Coated FOGRA39 (ISO 12647-2:2004)" RGBProfile="sRGB IEC61966-2.1" SolidColorIntent="UseColorSettings" AfterBlendingIntent="UseColorSettings" DefaultImageIntent="UseColorSettings" RGBPolicy="PreserveEmbeddedProfiles" CMYKPolicy="CombinationOfPreserveAndSafeCmyk" AccurateLABSpots="false">
  <idPkg:Graphic src="Resources/Graphic.xml"/>
  <idPkg:Fonts src="Resources/Fonts.xml"/>
  <idPkg:Styles src="Resources/Styles.xml"/>
  <idPkg:Preferences src="Resources/Preferences.xml"/>
  <Layer Self="u_layer" Name="Layer 1" Visible="true" Locked="false" IgnoreWrap="false" ShowGuides="true" LockGuides="false" UI="true" Expendable="true" Printable="true"><Properties><LayerColor type="enumeration">LightBlue</LayerColor></Properties></Layer>
${spreads.map((s) => `  <idPkg:Spread src="Spreads/Spread_${s[0]}.xml"/>`).join("\n")}
  <idPkg:BackingStory src="XML/BackingStory.xml"/>
${stories.map((s) => `  <idPkg:Story src="Stories/Story_${s[0]}.xml"/>`).join("\n")}
</Document>`;

  const idmlFiles = {
    mimetype: [strToU8("application/vnd.adobe.indesign-idml-package"), { level: 0 }],
    "META-INF/container.xml": strToU8(HEAD + '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="designmap.xml" media-type="text/xml"/></rootfiles></container>'),
    "designmap.xml": strToU8(designmap),
    "Resources/Graphic.xml": strToU8(graphicXml()),
    "Resources/Fonts.xml": strToU8(fontsXml()),
    "Resources/Styles.xml": strToU8(stylesXml()),
    "Resources/Preferences.xml": strToU8(preferencesXml(pageNo)),
    "XML/BackingStory.xml": strToU8(backing),
  };
  spreads.forEach(([sid, xml]) => { idmlFiles["Spreads/Spread_" + sid + ".xml"] = strToU8(xml); });
  stories.forEach(([sid, xml]) => { idmlFiles["Stories/Story_" + sid + ".xml"] = strToU8(xml); });
  const idml = zipSync(idmlFiles, { level: 6 });

  const pkg = { [name + "/" + name + ".idml"]: [idml, { level: 0 }] };
  Object.entries(links).forEach(([file, buf]) => { pkg[name + "/Links/" + file] = [new Uint8Array(buf), { level: 0 }]; });
  return { zip: Buffer.from(zipSync(pkg)), idml: Buffer.from(idml), pages: pageNo, links: Object.keys(links).length };
}

module.exports = { buildIdml };

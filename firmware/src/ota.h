#pragma once

// Signed over-the-air updates and the config the manifest carries alongside
// them. One check at the first successful connect of each boot, then every six
// hours - see otaTick().
void otaTick();

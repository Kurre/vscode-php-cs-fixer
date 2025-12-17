#!/bin/bash

# Update isExcluded test
sed -i '' 's/PHPCSFixer\.isExcluded/FormattingService.isExcluded/g' src/extension.isExcluded.test.ts
sed -i '' 's/import { PHPCSFixer } from/import { ConfigService } from ".\/config"\nimport { FormattingService } from/g' src/extension.isExcluded.test.ts
sed -i '' 's/let phpCSFixer: PHPCSFixer/let configService: ConfigService\n\tlet formattingService: FormattingService/g' src/extension.isExcluded.test.ts
sed -i '' 's/phpCSFixer = new PHPCSFixer()/configService = new ConfigService()\n\t\tformattingService = new FormattingService(configService)/g' src/extension.isExcluded.test.ts
sed -i '' 's/phpCSFixer\.isExcluded/formattingService.isExcluded/g' src/extension.isExcluded.test.ts
sed -i '' 's/phpCSFixer\.exclude/configService.exclude/g' src/extension.isExcluded.test.ts

# Update formatting test
sed -i '' 's/import { PHPCSFixer } from/import { ConfigService } from ".\/config"\nimport { FormattingService } from/g' src/extension.formatting.test.ts
sed -i '' 's/let phpCSFixer: PHPCSFixer/let configService: ConfigService\n\tlet formattingService: FormattingService/g' src/extension.formatting.test.ts  
sed -i '' 's/phpCSFixer = new PHPCSFixer()/configService = new ConfigService()\n\t\tformattingService = new FormattingService(configService)/g' src/extension.formatting.test.ts
sed -i '' 's/phpCSFixer\.format/formattingService.format/g' src/extension.formatting.test.ts
sed -i '' 's/phpCSFixer\.fix/formattingService.fix/g' src/extension.formatting.test.ts
sed -i '' 's/phpCSFixer\.diff/formattingService.diff/g' src/extension.formatting.test.ts
sed -i '' 's/phpCSFixer\.formattingProvider/formattingService.formattingProvider/g' src/extension.formatting.test.ts
sed -i '' 's/phpCSFixer\.rangeFormattingProvider/formattingService.rangeFormattingProvider/g' src/extension.formatting.test.ts

# Update autoFix test
sed -i '' 's/import { PHPCSFixer } from/import { ConfigService } from ".\/config"\nimport { FormattingService } from ".\/formattingService"\nimport { AutoFixService } from/g' src/extension.autoFix.test.ts
sed -i '' 's/let phpCSFixer: PHPCSFixer/let configService: ConfigService\n\tlet formattingService: FormattingService\n\tlet autoFixService: AutoFixService/g' src/extension.autoFix.test.ts
sed -i '' 's/phpCSFixer = new PHPCSFixer()/configService = new ConfigService()\n\t\tformattingService = new FormattingService(configService)\n\t\tautoFixService = new AutoFixService(formattingService)/g' src/extension.autoFix.test.ts
sed -i '' 's/phpCSFixer\.doAutoFixByBracket/autoFixService.doAutoFixByBracket/g' src/extension.autoFix.test.ts
sed -i '' 's/phpCSFixer\.doAutoFixBySemicolon/autoFixService.doAutoFixBySemicolon/g' src/extension.autoFix.test.ts


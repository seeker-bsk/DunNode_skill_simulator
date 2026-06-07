CC      = gcc
CFLAGS  = -std=c99 -Wall -Wextra -pedantic
TARGET  = simulator.exe
SRCS    = main.c skill.c tree.c simulator.c json_parser.c optimizer.c sp_allocator.c cJSON.c

$(TARGET): $(SRCS)
	$(CC) $(CFLAGS) -o $(TARGET) $(SRCS)

clean:
	del /Q $(TARGET) 2>nul || true
